# Juegos de cartas

Juegos de mesa con cartas, jugables en el navegador.

## ¡Jalón!

El tira y afloja con una sola ficha. Cada jugador saca una carta (del 1 al 10) y mueve la ficha ese número de casillas hacia el lado que quiera. Quien haga que la ficha llegue o pase la META gana.

- **Rayo:** si la ficha termina ahí, el mismo jugador vuelve a sacar.
- **Remolino:** la ficha regresa al INICIO.

Modos: 2 jugadores en el mismo celular, o contra la compu.

Código en [`jalon/index.html`](jalon/index.html): un solo archivo HTML, sin dependencias ni build.

## ¡Chápalo!

Juego de rapidez visual con temática limeña (modo "El Pozo"). Se reparten todas las cartas, una va al centro; cada jugador busca el símbolo que su carta comparte con la del centro y la bota encima. Gana quien se queda sin cartas primero. Fallar bloquea tu carta 2 segundos. Puedes pasar entre tus cartas (flechas o deslizando) y jugar cualquiera de ellas, como con el mazo en la mano.

- Mazos: Mini (13 cartas, 4 símbolos), Rápido (31, 6) y Clásico (55, 8). Cada par de cartas comparte exactamente un símbolo (plano proyectivo).
- Modos actuales: contra 1–3 bots (fácil, normal, pro) y duelo en un celular (pantalla dividida).
- Próximo: modo en línea con salas (Firebase Realtime Database + Vercel).

Archivos en [`chapalo/`](chapalo/): `engine.js` (reglas puras, listo para Firebase), `symbols.js` (57 símbolos; admite imágenes propias), `app.js` (interfaz). Pruebas: `node chapalo/test-engine.mjs`.

## Publicar con GitHub Pages

Settings → Pages → Source: *Deploy from a branch* → Branch: `main`, carpeta `/ (root)` → Save.
Los juegos quedan en `https://wilber16.github.io/juegos-uno/jalon/` y `https://wilber16.github.io/juegos-uno/chapalo/`.
