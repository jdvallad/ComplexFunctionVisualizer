#include "web_server.h"

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void print_usage(const char *prog) {
    printf("Usage: %s [OPTIONS]\n", prog);
    printf("  --host ADDR           Bind address (default: 127.0.0.1, env: CFV_HOST)\n");
    printf("  --port PORT           Listen port  (default: 1738,      env: CFV_PORT)\n");
    printf("  --web-dir DIR         Static web/ directory (default: web, env: CFV_WEB_DIR)\n");
    printf(
        "  --no-compile          Disable live /api/compile endpoint (env: CFV_ENABLE_COMPILE=0)\n");
    printf("  --compile-token TOK   Require X-Compile-Token header for /api/compile\n");
    printf("                        (env: CFV_COMPILE_TOKEN)\n");
    printf("  --public              Shorthand for --host 0.0.0.0 --no-compile\n");
}

static bool env_bool(const char *name, bool fallback) {
    const char *v = getenv(name);
    if (!v || !v[0]) {
        return fallback;
    }
    if (strcmp(v, "0") == 0 || strcmp(v, "false") == 0 || strcmp(v, "no") == 0) {
        return false;
    }
    return true;
}

int main(int argc, char **argv) {
    const char *env_host = getenv("CFV_HOST");
    const char *env_port = getenv("CFV_PORT");
    const char *env_web = getenv("CFV_WEB_DIR");

    ServerConfig cfg = {
        .host = (env_host && env_host[0]) ? env_host : "127.0.0.1",
        .port = (env_port && env_port[0]) ? atoi(env_port) : 1738,
        .web_dir = (env_web && env_web[0]) ? env_web : "web",
        .enable_compile = env_bool("CFV_ENABLE_COMPILE", true),
        .compile_token = getenv("CFV_COMPILE_TOKEN"),
    };

    if (cfg.port <= 0 || cfg.port > 65535) {
        cfg.port = 1738;
    }

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--port") == 0 && i + 1 < argc) {
            cfg.port = atoi(argv[++i]);
            if (cfg.port <= 0 || cfg.port > 65535) {
                fprintf(stderr, "Invalid port: %s\n", argv[i]);
                return EXIT_FAILURE;
            }
        } else if (strcmp(argv[i], "--host") == 0 && i + 1 < argc) {
            cfg.host = argv[++i];
        } else if (strcmp(argv[i], "--web-dir") == 0 && i + 1 < argc) {
            cfg.web_dir = argv[++i];
        } else if (strcmp(argv[i], "--no-compile") == 0) {
            cfg.enable_compile = false;
        } else if (strcmp(argv[i], "--compile-token") == 0 && i + 1 < argc) {
            cfg.compile_token = argv[++i];
        } else if (strcmp(argv[i], "--public") == 0) {
            cfg.host = "0.0.0.0";
            cfg.enable_compile = false;
        } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            print_usage(argv[0]);
            return EXIT_SUCCESS;
        } else {
            fprintf(stderr, "Unknown option: %s\n", argv[i]);
            print_usage(argv[0]);
            return EXIT_FAILURE;
        }
    }

    return web_server_run(&cfg);
}
