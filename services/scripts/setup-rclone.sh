#!/bin/bash
# Setup rclone for Google Drive upload on new VPS
set -e

echo "Installing rclone..."
curl https://rclone.org/install.sh | sudo bash

echo ""
echo "==================================="
echo "  rclone installed successfully!"
echo "==================================="
echo ""
echo "Next steps:"
echo "1. Run 'rclone config' to set up Google Drive remote"
echo "2. Name the remote 'gdrive'"
echo "3. Follow the OAuth flow to authorize access"
echo ""
echo "After setup, the upload-recordings.sh script will"
echo "automatically sync recordings to Google Drive."
