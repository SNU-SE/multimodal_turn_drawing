#!/bin/bash
# Upload completed recordings to Google Drive
# Run via cron: */5 * * * * /opt/scripts/upload-recordings.sh

RECORDINGS_DIR="${RECORDINGS_DIR:-/recordings}"
GDRIVE_REMOTE="gdrive:/연구녹화"
LOG_FILE="/var/log/rclone-upload.log"
DATE_FOLDER=$(date +%Y-%m-%d)

# Only process directories that have a composite.mp4 (post-processing complete)
for room_dir in "$RECORDINGS_DIR"/*/; do
  [ -d "$room_dir" ] || continue

  room_id=$(basename "$room_dir")
  composite="$room_dir/composite.mp4"

  if [ -f "$composite" ]; then
    echo "$(date): Uploading $room_id to Google Drive..." >> "$LOG_FILE"

    rclone move "$room_dir" "$GDRIVE_REMOTE/$DATE_FOLDER/$room_id/" \
      --log-file "$LOG_FILE" \
      --log-level INFO \
      --min-age 1m

    # Remove empty directory after successful upload
    rmdir "$room_dir" 2>/dev/null || true

    echo "$(date): Upload complete for $room_id" >> "$LOG_FILE"
  fi
done
