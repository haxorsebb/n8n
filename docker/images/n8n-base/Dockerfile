# syntax=docker/dockerfile:1.7

ARG APP_BASE_IMAGE=ghcr.io/haxorsebb/n8n-appliance-app-base:debian13-66f5d6635e17@sha256:5c60166ad2daa94f48f9af120fdbcba11cc7e7759f857b5237fc4ecf258d69de
ARG NODE_DONOR_IMAGE=dhi.io/node:26.5.1-debian13-dev@sha256:e85d8561e099d495fc29b118bb2f12d60e226c2faffa2f0b5b8fce8f99a81730

FROM ${NODE_DONOR_IMAGE} AS node-donor

FROM ${APP_BASE_IMAGE}

ARG DEBIAN_FRONTEND=noninteractive

# n8n-specific runtime dependencies. The common PAM/NSS/SSSD substrate is
# inherited from the appliance application base above.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        fontconfig \
        fonts-liberation \
        git \
        graphicsmagick \
        libgcc-s1 \
        librdkafka1 \
        libstdc++6 \
        openssh-client \
        pamtester \
        tini \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

# Carry only the Node runtime into the final image. npm/corepack remain build-time
# tools in the DHI Node builder stages and are intentionally absent at runtime.
COPY --from=node-donor /usr/bin/node /usr/bin/node

# Preserve the established n8n service identity without adding account-management
# tooling to the runtime image.
RUN printf '%s\n' \
        'node:x:1000:1000:node:/home/node:/bin/sh' \
        >> /etc/passwd \
 && printf '%s\n' \
        'node:x:1000:node' \
        >> /etc/group \
 && mkdir -p /home/node /usr/local/bin \
 && chown 1000:1000 /home/node \
 && ln -s /usr/bin/node /usr/local/bin/node \
 && printf '%s\n' \
        'auth required pam_sss.so' \
        'account required pam_sss.so' \
        > /etc/pam.d/n8n

WORKDIR /home/node
EXPOSE 5678/tcp
