// Rich Presence for Wine and Proton games: they look for Discord at \\.\pipe\discord-ipc-0 in their prefix, which Linux
// can't see. game-detection starts this in each Wine prefix as `bridge.exe PORT`, with MINCORD_WINE_TOKEN in its
// environment (not its arguments, which every user can read); it serves that pipe and carries each connection, bytes
// unchanged both ways, to game-detection on 127.0.0.1:PORT, which carries it on to discord-ipc-N. Each TCP connection
// starts with 64 bytes: P (a pipe client) or W (this bridge's own, held open) and TOKEN, NUL-padded. Winsock TCP
// because it works in every Wine: Proton's has no AF_UNIX (WSAEAFNOSUPPORT), and Linux system calls made directly from
// Windows code are caught by Wine's syscall dispatch.
//
// It makes itself a Wine system process, like services.exe: it doesn't keep the prefix alive, and exits when the
// prefix's last ordinary process does (Steam sees the game end as usual), or when game-detection does (its W connection
// closes; a new game-detection starts a new bridge).

#include <winsock2.h>
#include <windows.h>

// Wine's own information class (winternl.h): the event it returns is set once only system processes are left
#define ProcessWineMakeProcessSystem 1000
typedef LONG(WINAPI *SetInformationProcess)(HANDLE, ULONG, void *, ULONG);

static struct sockaddr_in addr = {.sin_family = AF_INET};
static char hello[64];

struct conn {
  HANDLE pipe;
  SOCKET sock;
};

// the pipe is overlapped so that one thread can read it while another writes
static BOOL pipe_io(HANDLE pipe, char *buf, DWORD n, DWORD *done, BOOL write) {
  OVERLAPPED o = {.hEvent = CreateEventW(NULL, TRUE, FALSE, NULL)};
  BOOL ok = write ? WriteFile(pipe, buf, n, NULL, &o) : ReadFile(pipe, buf, n, NULL, &o);
  if (ok || GetLastError() == ERROR_IO_PENDING) ok = GetOverlappedResult(pipe, &o, done, TRUE);
  CloseHandle(o.hEvent);
  return ok && *done > 0;
}

static DWORD WINAPI socket_to_pipe(void *arg) {
  struct conn *c = arg;
  char buf[16384];
  int n;
  DWORD done;
  while ((n = recv(c->sock, buf, sizeof buf, 0)) > 0)
    if (!pipe_io(c->pipe, buf, n, &done, TRUE)) break;
  CancelIoEx(c->pipe, NULL);
  return 0;
}

static SOCKET dial(char kind) {
  SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  char h[sizeof hello];
  memcpy(h, hello, sizeof h);
  h[0] = kind;
  if (s != INVALID_SOCKET && (connect(s, (struct sockaddr *)&addr, sizeof addr) || send(s, h, sizeof h, 0) != sizeof h)) {
    closesocket(s);
    s = INVALID_SOCKET;
  }
  return s;
}

static DWORD WINAPI watch(void *arg) {
  char b;
  while (recv((SOCKET)arg, &b, 1, 0) > 0);
  ExitProcess(0);
}

static DWORD WINAPI serve(void *arg) {
  struct conn *c = arg;
  if ((c->sock = dial('P')) != INVALID_SOCKET) {
    HANDLE back = CreateThread(NULL, 0, socket_to_pipe, c, 0, NULL);
    char buf[16384];
    DWORD n;
    while (pipe_io(c->pipe, buf, sizeof buf, &n, FALSE))
      if (send(c->sock, buf, n, 0) != (int)n) break;
    shutdown(c->sock, SD_BOTH);
    WaitForSingleObject(back, INFINITE);
    CloseHandle(back);
  }
  closesocket(c->sock);
  DisconnectNamedPipe(c->pipe);
  CloseHandle(c->pipe);
  free(c);
  return 0;
}

static DWORD WINAPI accept_loop(void *arg) {
  for (;;) {
    HANDLE pipe = CreateNamedPipeW(L"\\\\.\\pipe\\discord-ipc-0", PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
                                   PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT, PIPE_UNLIMITED_INSTANCES, 16384,
                                   16384, 0, NULL);
    if (pipe == INVALID_HANDLE_VALUE) return 1;
    OVERLAPPED o = {.hEvent = CreateEventW(NULL, TRUE, FALSE, NULL)};
    DWORD n;
    BOOL ok = ConnectNamedPipe(pipe, &o) || GetLastError() == ERROR_PIPE_CONNECTED ||
              (GetLastError() == ERROR_IO_PENDING && GetOverlappedResult(pipe, &o, &n, TRUE));
    CloseHandle(o.hEvent);
    if (!ok) {
      CloseHandle(pipe);
      continue;
    }
    struct conn *c = calloc(1, sizeof *c);
    c->pipe = pipe;
    CloseHandle(CreateThread(NULL, 0, serve, c, 0, NULL));
  }
}

int main(int argc, char **argv) {
  const char *token = getenv("MINCORD_WINE_TOKEN");
  if (argc < 2 || !token || strlen(token) >= sizeof hello) return 2;
  addr.sin_port = htons(atoi(argv[1]));
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  strcpy(hello + 1, token);
  WSADATA wsa;
  SOCKET held;
  if (WSAStartup(MAKEWORD(2, 2), &wsa) || (held = dial('W')) == INVALID_SOCKET) return 1;

  HANDLE done = NULL;
  SetInformationProcess set =
      (SetInformationProcess)GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtSetInformationProcess");
  if (!set || set(GetCurrentProcess(), ProcessWineMakeProcessSystem, &done, sizeof done) || !done) return 3;
  CloseHandle(CreateThread(NULL, 0, watch, (void *)held, 0, NULL));
  CloseHandle(CreateThread(NULL, 0, accept_loop, NULL, 0, NULL));
  WaitForSingleObject(done, INFINITE);
  return 0;
}
