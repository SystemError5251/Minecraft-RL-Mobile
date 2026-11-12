// Worker: erzeugt Chunks und Meshes abseits des Hauptthreads.
import { createService } from './chunkservice.js';
const handle = createService((msg, transfer) => postMessage(msg, transfer));
onmessage = (e) => handle(e.data);
postMessage({ type: 'ready' });
