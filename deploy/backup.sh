#!/usr/bin/env bash
# Compress all novel data into one archive: backups/novelxplin-data-YYYY-MM-DD.tar.gz
set -e
cd "$(dirname "$0")/.."
mkdir -p backups
F="backups/novelxplin-data-$(date +%F).tar.gz"
tar -czf "$F" data
ls -lh "$F"
# keep last 7
ls -t backups/*.tar.gz | tail -n +8 | xargs -r rm -f
