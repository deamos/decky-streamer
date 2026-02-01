#!/bin/sh
set -e

OUTDIR="/backend/out"

cd /backend

# Create output directory
mkdir -p "$OUTDIR"

# Copy GStreamer libraries
cp -r /pacman/usr/lib/* /backend/out/

# Copy psutil for process management
cp -r /psutil /backend/out/
