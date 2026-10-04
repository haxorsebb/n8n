ARG NODE_VERSION=26.5.1
ARG N8N_VERSION=snapshot

# Build native modules against the same Debian/glibc + Node ABI used by the
# appliance runtime. Both references are immutable.
ARG BUILDER_IMAGE=dhi.io/node:26.5.1-debian13-dev@sha256:e85d8561e099d495fc29b118bb2f12d60e226c2faffa2f0b5b8fce8f99a81730
ARG RUNTIME_IMAGE=ghcr.io/haxorsebb/n8n-base:26.5.1-system-auth-898e21fa0c07@sha256:56660e757680b4eb017b419d39798f36747aa5777d70547c4776e79e4c27ff64

# The runtime base has no compiler or npm, so this stage supplies the native
# build toolchain without carrying it into the final image.
FROM ${BUILDER_IMAGE} AS toolchain
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        g++ \
        librdkafka-dev \
        make \
        python3 \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

# Build isolated-vm in a separate stage. The only cache input is the module source.
# Below `COPY ./compiled`, each application change starts a new compile.
FROM toolchain AS native-builder
# `node_modules/isolated-vm` is a pnpm symlink, so copy the target directory.
# The wildcard tracks the version in the catalog.
COPY ./compiled/node_modules/.pnpm/isolated-vm@*/node_modules/isolated-vm /build/isolated-vm
WORKDIR /build/isolated-vm
# Build from source against this image's exact Node/glibc ABI. Use npm's bundled
# node-gyp without downloading another toolchain version.
RUN rm -rf prebuilds \
 && NODE_GYP="$(find /usr/lib/nodejs/npm -path '*/node-gyp/bin/node-gyp.js' -print -quit)" \
 && test -n "$NODE_GYP" \
 && node "$NODE_GYP" rebuild --release -j max

FROM toolchain AS builder
COPY ./compiled /usr/local/lib/node_modules/n8n
# sqlite3 is reachable through several symlinks in the pnpm tree; invoking
# node-gyp directly avoids concurrent npm rebuilds against the same store path.
RUN cd /usr/local/lib/node_modules/n8n/node_modules/sqlite3 \
 && NODE_GYP="$(find /usr/lib/nodejs/npm -path '*/node-gyp/bin/node-gyp.js' -print -quit)" \
 && test -n "$NODE_GYP" \
 && node "$NODE_GYP" rebuild --release

# CI's workspace install may not provide a binding for this Node version. Build
# against Debian's librdkafka and the exact Node ABI used above.
RUN cd /usr/local/lib/node_modules/n8n/node_modules/.pnpm/@confluentinc+kafka-javascript@*/node_modules/@confluentinc/kafka-javascript \
 && NODE_GYP="$(find /usr/lib/nodejs/npm -path '*/node-gyp/bin/node-gyp.js' -print -quit)" \
 && test -n "$NODE_GYP" \
 && BUILD_LIBRDKAFKA=0 node "$NODE_GYP" rebuild --release

COPY --from=native-builder /build/isolated-vm/build/Release/isolated_vm.node \
     /usr/local/lib/node_modules/n8n/node_modules/isolated-vm/build/Release/isolated_vm.node

# node-gyp-build finds build/Release first. The prebuilds are not needed in the
# appliance image once the matching native binding has been compiled.
RUN rm -rf /usr/local/lib/node_modules/n8n/node_modules/isolated-vm/prebuilds

FROM ${RUNTIME_IMAGE}

ARG N8N_VERSION
ARG N8N_RELEASE_TYPE=dev
ARG IMAGE_DESCRIPTION="Workflow Automation Tool"
ENV NODE_ENV=production
ENV N8N_RELEASE_TYPE=${N8N_RELEASE_TYPE}
ENV SHELL=/bin/sh

WORKDIR /home/node

COPY --from=builder /usr/local/lib/node_modules/n8n /usr/local/lib/node_modules/n8n
COPY docker/images/n8n/docker-entrypoint.sh /

RUN ln -s /usr/local/lib/node_modules/n8n/bin/n8n /usr/local/bin/n8n \
 && mkdir -p /home/node/.n8n \
 && chown -R node:node /home/node \
 && rm -rf /root/.npm /tmp/*

EXPOSE 5678/tcp
USER node
ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]

LABEL org.opencontainers.image.title="n8n" \
      org.opencontainers.image.description="${IMAGE_DESCRIPTION}" \
      org.opencontainers.image.source="https://github.com/n8n-io/n8n" \
      org.opencontainers.image.url="https://n8n.io" \
      org.opencontainers.image.version=${N8N_VERSION}
