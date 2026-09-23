# Official Cisco/Talos ClamAV 1.4.6 LTS, linux/amd64, resolved 2026-09-20.
# Copying the pinned filesystem into scratch drops upstream entrypoint/env/ports.
# No updater, daemon, network, package installation or host mount in this build.
FROM clamav/clamav@sha256:655c84d3d60f5830c8bc495c9410d39bca86d28723451d8bff5ca62c76bbdcaf AS upstream
FROM scratch
COPY --from=upstream / /
COPY --chmod=0555 scan /scanner/scan
USER 65532:65532
ENTRYPOINT ["/scanner/scan"]
LABEL pellum.scanner.engine="sha256:68791dcfb6b7822a70578b3b797b84227142f0018460fed22c7c818f5f26d54b"
LABEL pellum.scanner.signatures="sha256:20db5c4ea99545311d1081ca0944eb701701686e9e3d7670e9974bc8d0374986"
