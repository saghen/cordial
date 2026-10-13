// fdsock: a SOCK_SEQPACKET socketpair whose messages can carry file descriptors (SCM_RIGHTS), for Node. Node's own
// sockets drop passed fds; castscale (native/castscale) hands its DMA-BUFs over one of these.
//
//   const { open, listen, send, close } = require("./fdsock.node")
//   const [fd, childFd] = open()                    // give childFd to the child (spawn's stdio), then close(childFd)
//   listen(fd, (data, fds) => {})                   // data: Buffer, fds: number[] (ours to close); (null) at EOF
//   send(fd, "text")                                // non-blocking; false if the socket is full or gone
#define _GNU_SOURCE
#include <errno.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#include <node_api.h>

#define MAX_FDS 8
#define MAX_LEN 4096

struct msg {
	size_t len;
	int n_fds;
	int fds[MAX_FDS];
	char data[MAX_LEN];
};

struct listener {
	int fd;
	napi_threadsafe_function tsfn;
};

#define CHECK(env, call)                                                                                   \
	do {                                                                                               \
		if ((call) != napi_ok) {                                                                   \
			napi_throw_error(env, NULL, #call " failed");                                      \
			return NULL;                                                                       \
		}                                                                                          \
	} while (0)

static napi_value js_open(napi_env env, napi_callback_info info)
{
	int sv[2];
	if (socketpair(AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC, 0, sv) < 0) {
		napi_throw_error(env, NULL, strerror(errno));
		return NULL;
	}
	napi_value arr, a, b;
	CHECK(env, napi_create_array_with_length(env, 2, &arr));
	CHECK(env, napi_create_int32(env, sv[0], &a));
	CHECK(env, napi_create_int32(env, sv[1], &b));
	napi_set_element(env, arr, 0, a);
	napi_set_element(env, arr, 1, b);
	return arr;
}

// on the JS thread: a message (or NULL: EOF) to the callback
static void deliver(napi_env env, napi_value cb, void *ctx, void *data)
{
	struct msg *m = data;
	if (!env) {
		if (m)
			for (int i = 0; i < m->n_fds; i++)
				close(m->fds[i]);
		free(m);
		return;
	}
	napi_value undef, args[2];
	napi_get_undefined(env, &undef);
	if (m) {
		void *copy;
		napi_create_buffer_copy(env, m->len, m->data, &copy, &args[0]);
		napi_create_array_with_length(env, (size_t)m->n_fds, &args[1]);
		for (int i = 0; i < m->n_fds; i++) {
			napi_value v;
			napi_create_int32(env, m->fds[i], &v);
			napi_set_element(env, args[1], (uint32_t)i, v);
		}
	} else {
		napi_get_null(env, &args[0]);
		napi_create_array(env, &args[1]);
	}
	napi_call_function(env, undef, cb, 2, args, NULL);
	free(m);
}

static void *reader(void *arg)
{
	struct listener *l = arg;
	for (;;) {
		struct msg *m = calloc(1, sizeof(*m));
		struct iovec iov = {.iov_base = m->data, .iov_len = MAX_LEN};
		union {
			char buf[CMSG_SPACE(sizeof(int) * MAX_FDS)];
			struct cmsghdr align;
		} c;
		struct msghdr h = {.msg_iov = &iov, .msg_iovlen = 1, .msg_control = c.buf, .msg_controllen = sizeof(c.buf)};
		ssize_t n = recvmsg(l->fd, &h, MSG_CMSG_CLOEXEC);
		if (n < 0 && errno == EINTR) {
			free(m);
			continue;
		}
		if (n <= 0) {
			free(m);
			napi_call_threadsafe_function(l->tsfn, NULL, napi_tsfn_blocking);
			break;
		}
		m->len = (size_t)n;
		for (struct cmsghdr *ch = CMSG_FIRSTHDR(&h); ch; ch = CMSG_NXTHDR(&h, ch))
			if (ch->cmsg_level == SOL_SOCKET && ch->cmsg_type == SCM_RIGHTS) {
				int k = (int)((ch->cmsg_len - CMSG_LEN(0)) / sizeof(int));
				for (int i = 0; i < k; i++) {
					int fd;
					memcpy(&fd, CMSG_DATA(ch) + i * sizeof(int), sizeof(int));
					if (m->n_fds < MAX_FDS)
						m->fds[m->n_fds++] = fd;
					else
						close(fd);
				}
			}
		napi_call_threadsafe_function(l->tsfn, m, napi_tsfn_blocking);
	}
	napi_release_threadsafe_function(l->tsfn, napi_tsfn_release);
	free(l);
	return NULL;
}

static napi_value js_listen(napi_env env, napi_callback_info info)
{
	size_t argc = 2;
	napi_value argv[2], name;
	int32_t fd;
	CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
	CHECK(env, napi_get_value_int32(env, argv[0], &fd));
	struct listener *l = calloc(1, sizeof(*l));
	l->fd = fd;
	napi_create_string_utf8(env, "fdsock", NAPI_AUTO_LENGTH, &name);
	CHECK(env, napi_create_threadsafe_function(env, argv[1], NULL, name, 0, 1, NULL, NULL, NULL, deliver, &l->tsfn));
	pthread_t t;
	pthread_create(&t, NULL, reader, l);
	pthread_detach(t);
	return NULL;
}

static napi_value js_send(napi_env env, napi_callback_info info)
{
	size_t argc = 2, len;
	napi_value argv[2], ret;
	int32_t fd;
	char buf[MAX_LEN];
	CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
	CHECK(env, napi_get_value_int32(env, argv[0], &fd));
	CHECK(env, napi_get_value_string_utf8(env, argv[1], buf, sizeof(buf), &len));
	napi_get_boolean(env, send(fd, buf, len, MSG_DONTWAIT | MSG_NOSIGNAL) == (ssize_t)len, &ret);
	return ret;
}

static napi_value js_close(napi_env env, napi_callback_info info)
{
	size_t argc = 1;
	napi_value argv[1];
	int32_t fd;
	CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
	CHECK(env, napi_get_value_int32(env, argv[0], &fd));
	close(fd);
	return NULL;
}

NAPI_MODULE_INIT()
{
	napi_property_descriptor props[] = {
		{"open", NULL, js_open, NULL, NULL, NULL, napi_default, NULL},
		{"listen", NULL, js_listen, NULL, NULL, NULL, napi_default, NULL},
		{"send", NULL, js_send, NULL, NULL, NULL, napi_default, NULL},
		{"close", NULL, js_close, NULL, NULL, NULL, napi_default, NULL},
	};
	napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
	return exports;
}
