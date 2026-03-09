#!/bin/bash
# Upload completed recordings to Google Drive
# Run via cron: */5 * * * * /opt/scripts/upload-recordings.sh

RECORDINGS_DIR="${RECORDINGS_DIR:-/recordings}"
GDRIVE_REMOTE="gdrive:/연구녹화"
LOG_FILE="/var/log/rclone-upload.log"
DATE_FOLDER=$(date +%Y-%m-%d)
SUPABASE_URL="${SUPABASE_URL:-https://supabase.bioclass.kr}"
SUPABASE_SERVICE_KEY="${SUPABASE_SERVICE_KEY:-}"

# Only process directories that have a composite.mp4 (post-processing complete)
for room_dir in "$RECORDINGS_DIR"/*/; do
  [ -d "$room_dir" ] || continue

  room_id=$(basename "$room_dir")
  composite="$room_dir/composite.mp4"

  if [ -f "$composite" ]; then
    echo "$(date): Uploading $room_id to Google Drive..." >> "$LOG_FILE"

    rclone copy "$room_dir" "$GDRIVE_REMOTE/$DATE_FOLDER/$room_id/" \
      --log-file "$LOG_FILE" \
      --log-level INFO \
      --min-age 1m

    if [ $? -eq 0 ]; then
      GDRIVE_PATH="$GDRIVE_REMOTE/$DATE_FOLDER/$room_id"
      echo "$(date): Upload complete for $room_id" >> "$LOG_FILE"

      # Update recording_files in Supabase
      if [ -n "$SUPABASE_SERVICE_KEY" ]; then
        curl -s -X PATCH \
          "$SUPABASE_URL/rest/v1/recording_files?room_id=eq.$room_id&status=eq.processing" \
          -H "apikey: $SUPABASE_SERVICE_KEY" \
          -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
          -H "Content-Type: application/json" \
          -d "{\"status\": \"uploaded\", \"gdrive_url\": \"$GDRIVE_PATH\"}" \
          >> "$LOG_FILE" 2>&1
        echo "$(date): DB updated for $room_id" >> "$LOG_FILE"
      fi

      # Remove local files after successful upload and DB update
      rm -rf "$room_dir"
      echo "$(date): Local files cleaned for $room_id" >> "$LOG_FILE"
    else
      echo "$(date): Upload FAILED for $room_id" >> "$LOG_FILE"
    fi
  fi
done
