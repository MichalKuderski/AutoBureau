# Official Cisco/Talos ClamAV 1.4.6 LTS, linux/amd64, resolved 2026-09-27 (signatures refreshed; daily 28129).
# Copying the pinned filesystem into scratch drops upstream entrypoint/env/ports.
# No updater, daemon, network, package installation or host mount in this build.
FROM clamav/clamav@sha256:90382d8fb6d90959c0aeb3f16d24b3e58bb1166cc4103eec7c2c7beb79c76fdc AS upstream
FROM scratch
COPY --from=upstream / /
COPY --chmod=0555 scan /scanner/scan
USER 65532:65532
ENTRYPOINT ["/scanner/scan"]
LABEL pellum.scanner.engine="sha256:68791dcfb6b7822a70578b3b797b84227142f0018460fed22c7c818f5f26d54b"
LABEL pellum.scanner.signatures="sha256:e7dea76a8d130479468ac8ea8b7e66b84b5c9c9dbbabee20fdeb52ff34a2f7bd"
