import socket
import threading

TARGET = ("172.30.130.83", 8081)


def relay(source, destination):
    try:
        while True:
            data = source.recv(65536)
            if not data:
                break
            destination.sendall(data)
    except OSError:
        pass
    finally:
        try:
            destination.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def handle(client):
    try:
        target = socket.create_connection(TARGET, timeout=10)
        threading.Thread(target=relay, args=(client, target), daemon=True).start()
        relay(target, client)
        target.close()
    except OSError:
        pass
    finally:
        client.close()


server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("127.0.0.1", 8081))
server.listen(8)
while True:
    connection, _ = server.accept()
    threading.Thread(target=handle, args=(connection,), daemon=True).start()
