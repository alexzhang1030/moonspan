ARG BASE_IMAGE
FROM ${BASE_IMAGE}

ARG CYCLONE_PACKAGE
ARG CYCLONE_VERSION
ARG ZENOH_PACKAGE
ARG ZENOH_VERSION

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    "${CYCLONE_PACKAGE}=${CYCLONE_VERSION}" \
    "${ZENOH_PACKAGE}=${ZENOH_VERSION}" \
  && rm -rf /var/lib/apt/lists/*
