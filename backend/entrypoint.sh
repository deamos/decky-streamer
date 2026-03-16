#!/bin/sh
set -e

OUTDIR="/backend/out"

cd /backend

# Create output directory
mkdir -p "$OUTDIR"

# Copy GStreamer libraries
cp -r /pacman/usr/lib/* /backend/out/

# Copy rnnoise noise suppression LADSPA plugin
cp /rnnoise/librnnoise_ladspa.so /backend/out/

# Copy psutil for process management
cp -r /psutil /backend/out/
