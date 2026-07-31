// Imprime un documento HTML sin depender de window.open(): dentro del WebView de Tauri,
// abrir una ventana emergente nueva es poco confiable (puede tirar una excepción o no
// renderizar nada), y si eso pasa a mitad de camino, el código que sigue —como reiniciar
// el carrito después de imprimir un ticket— nunca se ejecuta. Un iframe oculto en la misma
// ventana evita el problema por completo, y el callback SIEMPRE se llama pase lo que pase.
export function printHtml(html: string, onDone?: () => void) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  function finish() {
    if (iframe.parentNode) document.body.removeChild(iframe);
    onDone?.();
  }

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    console.error("No se pudo preparar la impresión (sin acceso al documento del iframe).");
    finish();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (e) {
      console.error("Error al imprimir:", e);
    } finally {
      setTimeout(finish, 300);
    }
  }, 250);
}
