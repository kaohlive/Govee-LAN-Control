import { createSocket, Socket } from 'node:dgram';
import { networkInterfaces } from 'os';
const address = '239.255.255.250';
const port = 4002;


/**
 * Creates a UDP socket bound to 0.0.0.0 that joins the multicast group on all interfaces.
 * This approach is more reliable than binding to individual interfaces because:
 * 1. It ensures we receive responses regardless of which interface the device responds through
 * 2. It avoids the race condition where the "wrong" interface socket wins
 * 3. It properly handles network configurations where devices are reachable via routing
 */
export default (): Promise<Socket> =>
{
    return new Promise((resolve, reject) =>
    {
        const nets = networkInterfaces();
        var isResolved = false;
        var hasError = false;

        // Create a single socket bound to all interfaces (0.0.0.0)
        let socket = createSocket({
            type: 'udp4',
            reuseAddr: true
        });

        socket.on('error', (err) => {
            if (!isResolved && !hasError) {
                hasError = true;
                console.error(`[govee-lan-control] Socket error: ${err.message}`);
                // Don't reject, let the timeout handle it
            }
        });

        socket.once('message', (msg, remote) =>
        {
            if (!isResolved) {
                resolve(socket);
                isResolved = true;
            }
        });

        // Bind to all interfaces
        socket.bind(port, '0.0.0.0', () => {
            socket.setBroadcast(true);
            socket.setMulticastTTL(128);

            // Join multicast group on all suitable network interfaces
            let joinedAny = false;
            for (const name of Object.keys(nets))
            {
                nets[name]?.forEach((net) =>
                {
                    const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4;
                    if (net.family === familyV4Value && !net.internal)
                    {
                        try {
                            socket.addMembership(address, net.address);
                            joinedAny = true;
                        } catch (err) {
                            // Some interfaces may not support multicast, that's OK
                            console.warn(`[govee-lan-control] Could not join multicast on ${name} (${net.address}): ${err.message}`);
                        }
                    }
                });
            }

            if (!joinedAny) {
                console.error('[govee-lan-control] Warning: Could not join multicast group on any interface');
            }

            // Send discovery scan to multicast address
            let message = JSON.stringify(
                {
                    "msg": {
                        "cmd": "scan",
                        "data": {
                            "account_topic": "reserve",
                        }
                    }
                }
            );
            socket.send(message, 0, message.length, 4001, address);
        });

        setTimeout(() => {
            if (!isResolved) {
                if (!hasError) {
                    // No response received, but socket is valid - still return it
                    // This allows the caller to continue with periodic discovery
                    resolve(socket);
                    isResolved = true;
                } else {
                    try {
                        socket.close();
                    } catch (e) {}
                    resolve(undefined);
                }
            }
        }, 5000);
    });
};