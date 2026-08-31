#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: ./prepare-region.sh /data/region.osm.pbf" >&2
  exit 64
fi

PBF_PATH="$1"
DATA_DIR=$(dirname "$PBF_PATH")
PBF_NAME=$(basename "$PBF_PATH")
OSRM_IMAGE=${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:v26.8.0-debian}

docker run --rm -t -v "$DATA_DIR:/data" "$OSRM_IMAGE" osrm-extract -p /opt/car.lua "/data/$PBF_NAME"
OSRM_PATH="/data/${PBF_NAME%.osm.pbf}.osrm"
docker run --rm -t -v "$DATA_DIR:/data" "$OSRM_IMAGE" osrm-partition "$OSRM_PATH"
docker run --rm -t -v "$DATA_DIR:/data" "$OSRM_IMAGE" osrm-customize "$OSRM_PATH"
