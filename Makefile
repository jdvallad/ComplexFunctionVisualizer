CC = clang
CFLAGS = -Wall -Wextra -Werror -Wpedantic -O2
LINKAGE = -lm -lpthread -ldl
MATH_SOURCES = complex_math.c functions.c real_math.c real_functions.c
WEB_SOURCES = $(MATH_SOURCES) sampler.c hot_compile.c web_server.c main.c
TEST_SOURCES = $(MATH_SOURCES) sampler.c test_math.c

.PHONY: all web run test clean scan-build format valgrind drive docker-build docker-build-compiler docker-run

all: visualizer

visualizer: $(WEB_SOURCES) complex_math.h functions.h real_math.h real_functions.h sampler.h hot_compile.h web_server.h
	$(CC) $(CFLAGS) -rdynamic -o visualizer $(WEB_SOURCES) $(LINKAGE)

test_math: $(TEST_SOURCES) complex_math.h functions.h real_math.h real_functions.h sampler.h
	$(CC) $(CFLAGS) -o test_math $(TEST_SOURCES) -lm -lpthread

web: visualizer
	./visualizer

run: web

test: test_math
	./test_math

clean:
	rm -f visualizer
	rm -f test_math
	rm -f *.o

scan-build:
	scan-build make

format:
	$(CC)-format -i -style=file *.c *.h

valgrind: test_math
	valgrind --leak-check=full -s ./test_math

drive: clean format visualizer web

docker-build:
	docker build -t complex-visualizer:latest .

docker-build-compiler:
	docker build --build-arg WITH_CLANG=1 -t complex-visualizer:compiler .

docker-run:
	docker run --rm -p 1738:1738 --security-opt=no-new-privileges:true --cap-drop=ALL complex-visualizer:latest
