ARG NODE_VERSION=26.13.0
ARG PNPM_VERSION=12.4.2
ARG PYTHON_VERSION=3.13
ARG BUILD_IMAGE=dhi.io/node:26.13.0-debian13-dev@sha256:c64839f8a77451efb1f7f96e4ee8df8a1e8f2a08f92731f014bb32cd28250ab4
ARG RUNTIME_BASE=ghcr.io/haxorsebb/n8n-base:26.13.0-system-auth-267586399f5a@sha256:a5cfa9d35df1ff49845ff566604bb2d9f4adc6b5c8f8c976a571e0892dacbb9a

# ==============================================================================
# STAGE 1: JavaScript runner (@n8n/task-runner) artifact from CI
# ==============================================================================
FROM ${BUILD_IMAGE} AS javascript-runner-builder
COPY ./dist/task-runner-javascript /app/task-runner-javascript

WORKDIR /app/task-runner-javascript

# Pin pnpm to the repo's packageManager version. `pnpm deploy` drops the
# packageManager field from the deployed package.json, so nothing else here pins it.
ARG PNPM_VERSION
RUN npm i -g "pnpm@${PNPM_VERSION}"

# Remove `catalog` and `workspace` references from package.json to allow `pnpm add` in extended images
RUN node -e "const pkg = require('./package.json'); \
    Object.keys(pkg.dependencies || {}).forEach(k => { \
        const val = pkg.dependencies[k]; \
        if (val === 'catalog:' || val.startsWith('catalog:') || val.startsWith('workspace:')) \
            delete pkg.dependencies[k]; \
    }); \
    Object.keys(pkg.devDependencies || {}).forEach(k => { \
        const val = pkg.devDependencies[k]; \
        if (val === 'catalog:' || val.startsWith('catalog:') || val.startsWith('workspace:')) \
            delete pkg.devDependencies[k]; \
    }); \
    delete pkg.devDependencies; \
    require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2));"

# `--config.minimum-release-age=0`: pnpm defaults it to 1440 (24h), which would make
# this reject any dependency published less than a day ago — e.g. a first-party
# @n8n_io/ai-assistant-sdk bump landed within hours of its npm publish. This step only
# re-resolves an already-vetted, already-pinned dependency set; the real supply-chain age
# policy is enforced by the host install (pnpm-workspace.yaml + SafeChain).
# Install moment (special case for backwards compatibility)
RUN rm -f node_modules/.modules.yaml && \
    pnpm add moment@2.30.1 --save-prod --no-lockfile --config.minimum-release-age=0

# ==============================================================================
# STAGE 2: Python runner build (@n8n/task-runner-python) with uv
# Produces a relocatable venv tied to the python version used
# ==============================================================================
FROM ${RUNTIME_BASE} AS python-runner-builder
ARG TARGETPLATFORM
ARG UV_VERSION=0.8.14

# Build the Python environment against Debian/glibc, matching the final image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates curl gzip \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/*
RUN set -e; \
    case "$TARGETPLATFORM" in \
      "linux/amd64") UV_ARCH="x86_64-unknown-linux-gnu" ;; \
      "linux/arm64") UV_ARCH="aarch64-unknown-linux-gnu" ;; \
      *) echo "Unsupported platform: $TARGETPLATFORM" >&2; exit 1 ;; \
    esac; \
    mkdir -p /tmp/uv; cd /tmp/uv; \
    curl -fsSLO "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${UV_ARCH}.tar.gz"; \
    curl -fsSLO "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${UV_ARCH}.tar.gz.sha256"; \
    sha256sum -c "uv-${UV_ARCH}.tar.gz.sha256"; \
    tar -xzf "uv-${UV_ARCH}.tar.gz"; \
    install -m 0755 "uv-${UV_ARCH}/uv" /usr/local/bin/uv; \
    rm -rf /tmp/uv

WORKDIR /app/task-runner-python

COPY packages/@n8n/task-runner-python/pyproject.toml \
     packages/@n8n/task-runner-python/uv.lock** \
     packages/@n8n/task-runner-python/.python-version** \
     ./

RUN uv venv
RUN uv sync \
			--frozen \
			--no-editable \
			--no-install-project \
			--no-dev \
			--all-extras

COPY packages/@n8n/task-runner-python/ ./
RUN uv sync \
      --frozen \
			--no-dev \
			--all-extras \
      --no-editable

# Install the python runner package itself into site packages. We can remove the src directory then
RUN uv pip install . && rm -rf /app/task-runner-python/src

# ==============================================================================
# STAGE 3: Task Runner Launcher download
# ==============================================================================
FROM ${BUILD_IMAGE} AS launcher-downloader
ARG TARGETPLATFORM
ARG LAUNCHER_VERSION=1.5.1
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gzip \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

RUN set -e; \
    case "$TARGETPLATFORM" in \
        "linux/amd64") ARCH_NAME="amd64" ;; \
        "linux/arm64") ARCH_NAME="arm64" ;; \
        *) echo "Unsupported platform: $TARGETPLATFORM" && exit 1 ;; \
    esac; \
    mkdir /launcher-temp && cd /launcher-temp; \
    curl -fsSLO "https://github.com/n8n-io/task-runner-launcher/releases/download/${LAUNCHER_VERSION}/task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz"; \
    curl -fsSLO "https://github.com/n8n-io/task-runner-launcher/releases/download/${LAUNCHER_VERSION}/task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz.sha256"; \
    echo "$(cat task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz.sha256) task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz" > checksum.sha256; \
    sha256sum -c checksum.sha256; \
    mkdir -p /launcher-bin; \
    tar xzf task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz -C /launcher-bin; \
    cd / && rm -rf /launcher-temp

# ==============================================================================
# STAGE 4: Debian 13 runtime with common appliance PAM/NSS/SSSD substrate
# ==============================================================================
FROM ${RUNTIME_BASE} AS runtime
ARG N8N_VERSION=snapshot
ARG N8N_RELEASE_TYPE=dev

ENV NODE_ENV=production \
    N8N_RELEASE_TYPE=${N8N_RELEASE_TYPE} \
    SHELL=/bin/sh

# Match the Python interpreter used for the glibc virtual environment.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/* \
 && printf '%s\n' 'runner:x:1001:' >> /etc/group \
 && printf '%s\n' 'runner:x:1001:1001:runner:/home/runner:/bin/sh' >> /etc/passwd \
 && mkdir -p /home/runner \
 && chown 1001:1001 /home/runner

COPY --from=python-runner-builder /usr/local/bin/uv /usr/local/bin/uv
COPY --from=javascript-runner-builder /app/task-runner-javascript /opt/runners/task-runner-javascript
COPY --from=python-runner-builder /app/task-runner-python /opt/runners/task-runner-python
COPY --from=launcher-downloader /launcher-bin/ /usr/local/bin/
COPY docker/images/runners/n8n-task-runners.json /etc/n8n-task-runners.json

WORKDIR /home/runner
USER runner

EXPOSE 5680/tcp
ENTRYPOINT ["tini", "--", "/usr/local/bin/task-runner-launcher"]
CMD ["javascript", "python"]

LABEL org.opencontainers.image.title="n8n task runners" \
      org.opencontainers.image.description="Sidecar image providing n8n task runners for JavaScript and Python code execution" \
      org.opencontainers.image.source="https://github.com/n8n-io/n8n" \
      org.opencontainers.image.url="https://n8n.io" \
      org.opencontainers.image.version="${N8N_VERSION}"
