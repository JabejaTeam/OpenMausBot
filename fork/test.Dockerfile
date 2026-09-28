# Jabeja fork only: test image for fork/test-beast.sh. Mirrors GitHub's
# ubuntu runner closely enough for the suite: Node 24 in /usr/local/bin,
# git, and the shared libraries Electron needs to start.
FROM node:24-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
      git libasound2 libnss3 libgbm1 libgtk-3-0 libxss1 libxshmfence1 libdrm2 \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
