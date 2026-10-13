PREFIX ?= /usr/local
PKGS = libpipewire-0.3 libva libva-drm libdrm gbm egl libsystemd
CFLAGS ?= -O2 -g
CFLAGS += -Wall -Wextra -Wno-unused-parameter -Wno-missing-field-initializers -std=gnu11 $(shell pkg-config --cflags $(PKGS))
LDLIBS += $(shell pkg-config --libs $(PKGS)) -lm

capture: capture.c av1enc.c av1enc.h
	$(CC) $(CFLAGS) -o $@ capture.c av1enc.c $(LDLIBS)

install: capture
	install -Dm755 capture $(PREFIX)/bin/mincord-capture

clean:
	rm -f capture

.PHONY: install clean
