import type { GlobalSessionEvent, RealtimeEvent, SessionUiEvent } from "../../shared/apiTypes.ts";

export interface RealtimeSocket {
	readonly OPEN: number;
	readyState: number;
	send(payload: string): void;
	on(event: "close", listener: () => void): unknown;
}

export class SessionEventHub {
	private readonly socketsBySession = new Map<string, Set<RealtimeSocket>>();
	private readonly globalSockets = new Set<RealtimeSocket>();

	add(sessionId: string, socket: RealtimeSocket): void {
		let sockets = this.socketsBySession.get(sessionId);
		if (!sockets) {
			sockets = new Set();
			this.socketsBySession.set(sessionId, sockets);
		}
		sockets.add(socket);
		socket.on("close", () => {
			sockets.delete(socket);
			if (sockets.size === 0 && this.socketsBySession.get(sessionId) === sockets) this.socketsBySession.delete(sessionId);
		});
	}

	addGlobal(socket: RealtimeSocket): void {
		this.globalSockets.add(socket);
		socket.on("close", () => this.globalSockets.delete(socket));
	}

	publish(sessionId: string, event: SessionUiEvent): void {
		const payload = JSON.stringify(event);
		const sockets = this.socketsBySession.get(sessionId);
		if (sockets === undefined) return;
		for (const socket of sockets) {
			if (socket.readyState === socket.OPEN) socket.send(payload);
			else sockets.delete(socket);
		}
		if (sockets.size === 0) this.socketsBySession.delete(sessionId);
	}

	publishGlobal(event: GlobalSessionEvent): void {
		this.publishRealtime(event);
	}

	publishRealtime(event: RealtimeEvent): void {
		const payload = JSON.stringify(event);
		for (const socket of this.globalSockets) {
			if (socket.readyState === socket.OPEN) socket.send(payload);
			else this.globalSockets.delete(socket);
		}
	}
}
