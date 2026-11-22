#ifndef WEB_SERVER_H
#define WEB_SERVER_H

#include <stdbool.h>

typedef struct {
    const char *host;
    int port;
    const char *web_dir;
    bool enable_compile;
    const char *compile_token; /* NULL or empty = no token required */
} ServerConfig;

/*
 * Starts the multi-threaded HTTP server using cfg and blocks until
 * SIGINT or SIGTERM is received. Returns 0 on clean shutdown, non-zero on error.
 */
int web_server_run(const ServerConfig *cfg);

#endif /* WEB_SERVER_H */
