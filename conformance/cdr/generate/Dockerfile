# Default is digest-pinned; build scripts always pass --build-arg BASE_IMAGE for
# each distro so Humble and Jazzy both stay pinned to their support-matrix digests.
ARG BASE_IMAGE=docker.io/library/ros:humble-ros-base-jammy@sha256:7bea3d9aa2483d3ca34c8e30d921b79273b0913bd7dc64bebf51d082b5d107e4
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
