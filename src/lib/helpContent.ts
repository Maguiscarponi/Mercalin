export interface HelpItem {
  label: string;
  description: string;
}

export interface HelpSection {
  title: string;
  items: HelpItem[];
}

export interface HelpContent {
  title: string;
  intro: string;
  sections: HelpSection[];
}

// Un color por módulo (el mismo que su grupo en el menú lateral, ver
// GROUP_ACCENT en Layout.tsx) -- así el botón y el modal de ayuda se sienten
// parte de esa sección en vez de ser todos el mismo rojo genérico.
export interface HelpAccent {
  button: string;
  badge: string;
  badgeIcon: string;
  sectionTitle: string;
}

const RED: HelpAccent = {
  button: "bg-red-50 text-red-600 hover:bg-red-100",
  badge: "bg-red-100",
  badgeIcon: "text-red-600",
  sectionTitle: "text-red-600",
};
const EMERALD: HelpAccent = {
  button: "bg-emerald-50 text-emerald-600 hover:bg-emerald-100",
  badge: "bg-emerald-100",
  badgeIcon: "text-emerald-600",
  sectionTitle: "text-emerald-600",
};
const AMBER: HelpAccent = {
  button: "bg-amber-50 text-amber-600 hover:bg-amber-100",
  badge: "bg-amber-100",
  badgeIcon: "text-amber-600",
  sectionTitle: "text-amber-600",
};
const VIOLET: HelpAccent = {
  button: "bg-violet-50 text-violet-600 hover:bg-violet-100",
  badge: "bg-violet-100",
  badgeIcon: "text-violet-600",
  sectionTitle: "text-violet-600",
};
const STONE: HelpAccent = {
  button: "bg-stone-100 text-stone-500 hover:bg-stone-200",
  badge: "bg-stone-200",
  badgeIcon: "text-stone-600",
  sectionTitle: "text-stone-600",
};

export const helpAccent: Record<string, HelpAccent> = {
  // Operación
  caja: RED, "caja-gestion": RED, clientes: RED, devoluciones: RED,
  // Catálogo
  productos: EMERALD, proveedores: EMERALD, categorias: EMERALD,
  vencimientos: EMERALD, inventario: EMERALD, etiquetas: EMERALD, combos: EMERALD,
  // Gestión
  presupuestos: AMBER, promociones: AMBER, facturacion: AMBER, usuarios: AMBER,
  // Análisis
  dashboard: VIOLET, reportes: VIOLET,
  // Sistema
  auditoria: STONE, configuracion: STONE,
};

export const helpContent: Record<string, HelpContent> = {
  caja: {
    title: "Caja — Cómo vender",
    intro:
      "La Caja es donde hacés las ventas del día. Acá agregás los productos, aplicás descuentos y cobrás al cliente.",
    sections: [
      {
        title: "Antes de empezar",
        items: [
          {
            label: "Abrí la caja primero",
            description:
              "Para poder vender necesitás tener una sesión de caja abierta. Si ves la pantalla de 'Caja cerrada', hacé clic en 'Abrir caja', ingresá el monto inicial de efectivo que tenés y listo.",
          },
        ],
      },
      {
        title: "Cómo agregar productos",
        items: [
          {
            label: "Escribiendo el nombre",
            description:
              "Escribí las primeras letras del producto en el campo de búsqueda de arriba. Aparece una lista con los resultados — hacé clic en el que querés o presioná Enter para seleccionar el primero.",
          },
          {
            label: "Con lector de código de barras",
            description:
              "Si tenés una pistola lectora, apuntala al código de barras del producto y apretá el gatillo. El producto se agrega solo al carrito sin que tengas que escribir nada.",
          },
          {
            label: "Escribiendo el código de barras",
            description:
              "También podés escribir el código de barras a mano en el buscador y presionar Enter.",
          },
        ],
      },
      {
        title: "El carrito (la lista de productos)",
        items: [
          {
            label: "Cambiar la cantidad",
            description:
              "Usá los botones + y − que aparecen al lado de cada producto para subir o bajar la cantidad.",
          },
          {
            label: "Eliminar un producto",
            description:
              "Hacé clic en la X que aparece a la derecha del producto para sacarlo de la venta.",
          },
          {
            label: "Precio tachado",
            description:
              "Si un producto tiene algún descuento aplicado, el precio original aparece tachado y se muestra el precio con descuento.",
          },
          {
            label: "Ícono de advertencia ⚠",
            description:
              "Si la cantidad que agregaste es mayor al stock disponible, aparece un ⚠ avisándote que puede que no tengas suficientes unidades.",
          },
        ],
      },
      {
        title: "Listas de precio",
        items: [
          {
            label: "Minorista / Mayorista / Especial",
            description:
              "Arriba a la derecha podés elegir qué lista de precios usar. Minorista es para ventas normales. Mayorista para clientes que compran en cantidad. Especial para casos particulares. Los nombres los configurás en Configuración.",
          },
        ],
      },
      {
        title: "Descuentos",
        items: [
          {
            label: "Descuento en pesos ($)",
            description:
              "Elegí el modo $ y escribí el importe a descontar. Por ejemplo: escribís 500 y le hace un descuento de $500 a toda la venta.",
          },
          {
            label: "Descuento en porcentaje (%)",
            description:
              "Elegí el modo % y escribí el porcentaje. Por ejemplo: escribís 10 y le hace un 10% de descuento al total.",
          },
          {
            label: "Quitar el descuento",
            description:
              "Hacé clic en la X que aparece al lado del campo de descuento para borrarlo.",
          },
        ],
      },
      {
        title: "Cobrar",
        items: [
          {
            label: "Botón COBRAR (o Enter / F2)",
            description:
              "Cuando tenés todos los productos en el carrito, hacé clic en el botón rojo grande que dice 'Cobrar', o presioná Enter con el buscador vacío, o F2. Se abre una ventana donde elegís cómo paga el cliente. Si en tu teclado F2 no responde sin apretar Fn, usá Enter — funciona igual en cualquier teclado.",
          },
          {
            label: "Formas de pago",
            description:
              "Efectivo (calcula el vuelto solo), Débito, Crédito, QR / MP, Transferencia o Cuenta corriente (Cta. Cte. — solo si le asignaste un cliente a la venta con 'Asignar cliente').",
          },
          {
            label: "Pago mixto",
            description:
              "Si el cliente paga parte en efectivo y parte con tarjeta (por ejemplo), activá 'Pago mixto' en la ventana de cobro. Podés cargar hasta 4 formas de pago distintas para una misma venta — el sistema te muestra cuánto falta cubrir hasta que llegues al total.",
          },
          {
            label: "Imprimir presupuesto",
            description:
              "Si el cliente quiere llevarse un presupuesto sin comprar, usá el botón 'Presupuesto'. Se abre una ventana para imprimir con todos los productos y el total. El presupuesto aclara que no es una factura y tiene validez de 24 horas.",
          },
        ],
      },
      {
        title: "Otras funciones",
        items: [
          {
            label: "Asignar un cliente",
            description:
              "Hacé clic en 'Asignar cliente' para vincular la venta a un cliente de tu lista. Esto es útil para llevar cuenta corriente o para ventas a clientes frecuentes.",
          },
          {
            label: "Consulta de precio (F3)",
            description:
              "¿Querés saber el precio de un producto sin agregarlo a la venta? Usá el botón 'Precio' o presioná F3. Escribís el nombre o código y te muestra el precio y el stock disponible.",
          },
          {
            label: "Anular toda la venta",
            description:
              "Si necesitás empezar de cero, usá el botón 'Anular venta'. El sistema te pide confirmación antes de borrar todo.",
          },
          {
            label: "Botones de acceso rápido",
            description:
              "Si el negocio tiene servicios o artículos sin código (como bolsas, envases, etc.), pueden aparecer como botones rápidos abajo a la derecha. Configurás esos botones desde Configuración.",
          },
          {
            label: "🎁 Combos",
            description:
              "Si activaste 'Combos y packs' en Configuración y armaste alguno, aparece este botón para elegir un combo y agregarlo a la venta con su precio fijo. También podés escanear directamente el código de barras del combo.",
          },
        ],
      },
      {
        title: "Atajos de teclado",
        items: [
          {
            label: "Enter",
            description:
              "Si el buscador está vacío y hay productos en el carrito, abre la pantalla de cobro. Funciona en cualquier teclado — es el atajo más confiable para cobrar.",
          },
          {
            label: "F2",
            description:
              "Abre la pantalla de cobro (igual que hacer clic en el botón COBRAR). En algunas notebooks hay que mantener Fn apretado para que F2 funcione como tecla de función — si te pasa, usá Enter.",
          },
          {
            label: "F3",
            description: "Abre la consulta de precio sin agregar al carrito.",
          },
          {
            label: "Escape",
            description: "Cierra cualquier ventana emergente que esté abierta.",
          },
        ],
      },
    ],
  },

  "caja-gestion": {
    title: "Gestión de caja — Abrir, cerrar y controlar el efectivo",
    intro:
      "Acá controlás el efectivo de cada turno: abrís la caja al empezar el día, registrás ingresos o egresos manuales, y hacés el arqueo al cerrar. Solo lo ven supervisores y administradores.",
    sections: [
      {
        title: "Abrir caja",
        items: [
          {
            label: "Botón 'Abrir caja'",
            description:
              "Contás el efectivo que tenés físicamente antes de empezar a vender y lo cargás en 'Efectivo en caja'. Ese número es el punto de partida para calcular el saldo esperado durante todo el turno.",
          },
          {
            label: "¿Por qué me pide abrir caja para vender?",
            description:
              "En Caja no se puede cobrar ninguna venta sin una sesión abierta — es lo que permite que, al cerrar, el sistema sepa cuánto efectivo debería haber.",
          },
        ],
      },
      {
        title: "Mientras la caja está abierta",
        items: [
          {
            label: "Botón 'Administrar' / 'Ver caja abierta'",
            description:
              "Abre el panel con el resumen en vivo: apertura, ventas totales, ventas en efectivo, ingresos y egresos manuales, y el saldo esperado en el cajón en este momento.",
          },
          {
            label: "+ Movimiento",
            description:
              "Para registrar plata que entra o sale del cajón sin ser una venta: un ingreso (por ejemplo, un aporte de fondo) o un egreso (pago de un flete, un retiro). Elegís el tipo, el monto y un concepto breve.",
          },
        ],
      },
      {
        title: "Cerrar caja (arqueo)",
        items: [
          {
            label: "Botón 'Cerrar caja'",
            description:
              "Contás físicamente todo el efectivo del cajón y lo cargás en 'Efectivo contado'. El sistema lo compara con el saldo esperado y te muestra si hay sobrante o faltante, y de cuánto.",
          },
          {
            label: "El campo no viene precargado a propósito",
            description:
              "Tenés que escribir vos lo que contaste de verdad — así el arqueo sirve para detectar diferencias reales, no para confirmar a ciegas lo que el sistema espera.",
          },
          {
            label: "Una vez cerrada, no se puede reabrir",
            description:
              "Revisá bien el conteo antes de confirmar. Si necesitás volver a vender, tenés que abrir una sesión nueva.",
          },
        ],
      },
      {
        title: "Historial de sesiones",
        items: [
          {
            label: "La tabla de abajo",
            description:
              "Lista todas las cajas abiertas y cerradas, con fecha de apertura, cierre, fondo inicial, monto de cierre y estado.",
          },
          {
            label: "Botón 'Ver'",
            description:
              "Abre el detalle completo de esa sesión: ventas totales, desglose por forma de pago (efectivo, débito, crédito, QR/MP, transferencia, etc.), ingresos y egresos manuales, y la diferencia del arqueo si ya está cerrada.",
          },
        ],
      },
    ],
  },

  clientes: {
    title: "Clientes — Fichas y cuenta corriente",
    intro:
      "Acá administrás tu cartera de clientes: datos de contacto, cuenta corriente (fiado) y quiénes están comprando más o menos que antes.",
    sections: [
      {
        title: "La lista de clientes",
        items: [
          {
            label: "Etiquetas de comportamiento",
            description:
              "El sistema analiza cuánto y cuándo compra cada cliente y le pone una etiqueta sola: ⭐ VIP (compra mucho y seguido), ✅ Habitual, 🆕 Nuevo, ⚠️ En riesgo (dejó de venir) o 🔴 Deudor (debe mucho). Te sirve para saber a quién llamar o a quién ofrecerle algo.",
          },
          {
            label: "Columna 'Deuda' y 'Límite'",
            description:
              "Muestra cuánto te debe cada cliente en cuenta corriente y hasta cuánto le permitís deber (el límite de crédito que le configuraste).",
          },
          {
            label: "Filtro 'con deuda' y 'Deuda total'",
            description:
              "El botón de arriba filtra la lista para ver solo a los que te deben algo, y al lado te muestra cuánto suman todas las deudas juntas.",
          },
        ],
      },
      {
        title: "Crear o editar un cliente",
        items: [
          {
            label: "Botón 'Nuevo cliente'",
            description:
              "Solo el nombre es obligatorio. El resto (teléfono, DNI, dirección, email, notas) es opcional pero ayuda a identificarlo rápido en el buscador de Caja.",
          },
          {
            label: "Límite de crédito",
            description:
              "Es el tope de deuda que le permitís acumular en cuenta corriente. Si en Caja intentás fiarle una venta que supera ese límite, el sistema te avisa.",
          },
          {
            label: "Condición frente al IVA",
            description:
              "Se usa para facturar correctamente si el cliente pide factura A (Responsable Inscripto) en vez de la B/C habitual — se completa junto con Facturación (ARCA).",
          },
        ],
      },
      {
        title: "Cuenta corriente (fiado)",
        items: [
          {
            label: "Botón 'Ver cuenta'",
            description:
              "Abre el historial completo del cliente: la pestaña 'Cuenta corriente' con cada venta fiada y cada pago, y la pestaña 'Compras' con todo lo que le vendiste (haya sido fiado o no).",
          },
          {
            label: "Registrar un pago",
            description:
              "Desde la ficha del cliente, cargá el monto que te paga y un concepto ('Pago de deuda' por defecto) para descontarlo de su saldo deudor.",
          },
          {
            label: "Imprimir estado de cuenta",
            description:
              "Genera un resumen imprimible con el saldo actual, el límite de crédito y el detalle de movimientos — útil para entregarle al cliente o para tus registros.",
          },
        ],
      },
      {
        title: "Desactivar y reactivar",
        items: [
          {
            label: "Botón 'Desactivar'",
            description:
              "Saca al cliente de la lista principal sin borrar su historial ni su deuda. Si tiene saldo pendiente, el sistema te avisa antes de confirmar — la cuenta corriente queda guardada.",
          },
          {
            label: "Ver e Reactivar",
            description:
              "Tildá 'Inactivos' para ver los clientes desactivados y usá 'Reactivar' para que vuelvan a aparecer en la lista normal, con todo su historial intacto.",
          },
        ],
      },
    ],
  },

  devoluciones: {
    title: "Devoluciones — Cambios y reintegros",
    intro:
      "Registrá acá cualquier devolución de un producto ya vendido: el stock vuelve solo, y si la venta tenía factura ARCA, se emite la nota de crédito correspondiente.",
    sections: [
      {
        title: "Paso 1: Buscar la venta original",
        items: [
          {
            label: "Ventas recientes (sin saber el número)",
            description:
              "Es la opción que abre por defecto. Elegí el día y aparece la lista de ventas de esa fecha, más nuevas primero, con hora, monto y forma de pago — reconocés la venta a simple vista sin necesidad del ticket.",
          },
          {
            label: "Por número de venta",
            description:
              "Si tenés el ticket a mano, escribí el número directamente.",
          },
          {
            label: "Por cliente",
            description:
              "Buscá al cliente y elegí entre sus ventas registradas — útil para clientes frecuentes o con cuenta corriente.",
          },
        ],
      },
      {
        title: "Paso 2: Elegir qué devolver",
        items: [
          {
            label: "Devolución parcial",
            description:
              "No hace falta devolver toda la venta: tildá solo los productos (o combos) que el cliente trae, y ajustá la cantidad si devuelve menos unidades de las que compró.",
          },
          {
            label: "No se puede devolver dos veces lo mismo",
            description:
              "El sistema recuerda cuánto ya devolviste de esa venta y no te deja devolver más unidades de las que quedan disponibles.",
          },
        ],
      },
      {
        title: "Paso 3: Motivo y confirmación",
        items: [
          {
            label: "Motivo",
            description:
              "Elegí uno de la lista: producto defectuoso, error de cobro, cambio por otro producto, producto vencido, no era lo que quería, u otro (con notas propias).",
          },
          {
            label: "El stock se restituye solo",
            description:
              "Al confirmar, las unidades devueltas vuelven automáticamente al stock del producto — no hace falta ajustarlo a mano en Productos.",
          },
          {
            label: "Nota de crédito automática",
            description:
              "Si la venta original tenía una factura ARCA vigente, el sistema emite la nota de crédito correspondiente al confirmar. Si falla, la devolución igual queda registrada y podés reintentar la nota de crédito desde Facturación (ARCA).",
          },
          {
            label: "El reintegro en efectivo no es automático",
            description:
              "Esta pantalla registra la devolución y repone el stock, pero no saca plata del cajón sola. Si le devolvés dinero en efectivo al cliente, registralo como un egreso en Gestión de caja para que el arqueo del día cierre bien.",
          },
        ],
      },
      {
        title: "Historial",
        items: [
          {
            label: "Pestaña 'Historial'",
            description:
              "Lista todas las devoluciones ya registradas, con fecha, venta de origen, motivo y monto.",
          },
        ],
      },
    ],
  },

  proveedores: {
    title: "Proveedores — Compras y reposición",
    intro:
      "Acá cargás tus proveedores, generás órdenes de compra y usás el análisis automático para saber qué reponer, a quién le compraste más caro y quién te cumple los tiempos.",
    sections: [
      {
        title: "Proveedores",
        items: [
          {
            label: "Botón 'Nuevo proveedor'",
            description:
              "Cargá nombre, contacto, teléfono y demás datos. Cada producto de tu catálogo se puede vincular a un proveedor para saber a quién comprarle cuando falte.",
          },
          {
            label: "Botón 'Nueva orden' (en la fila del proveedor)",
            description:
              "Arma una orden de compra para ese proveedor: elegís los productos y las cantidades que le vas a pedir.",
          },
        ],
      },
      {
        title: "Órdenes de compra",
        items: [
          {
            label: "El número entre paréntesis en la pestaña",
            description:
              "Muestra cuántas órdenes están 'pendientes' — ya las creaste pero todavía no llegó la mercadería.",
          },
          {
            label: "Botón 'Confirmar recepción'",
            description:
              "Cuando te llega el pedido del proveedor, abrís la orden y confirmás la recepción: el stock de cada producto de la orden se actualiza solo, sumando las cantidades recibidas.",
          },
          {
            label: "Botón 'Cancelar orden'",
            description:
              "Si el proveedor no te va a entregar ese pedido, cancelá la orden para que deje de contar como pendiente.",
          },
        ],
      },
      {
        title: "Proyección 7 días",
        items: [
          {
            label: "¿Qué muestra?",
            description:
              "Analiza la velocidad de venta de cada producto y te dice a cuántos días te vas a quedar sin stock, cuánto conviene comprar y a qué proveedor. Los que están en naranja o amarillo necesitan reposición pronto.",
          },
          {
            label: "Botón 'Generar orden de compra'",
            description:
              "Crea automáticamente una o varias órdenes de compra con las cantidades sugeridas para los productos de esta lista, agrupadas por proveedor.",
          },
        ],
      },
      {
        title: "Lead times (tiempos de entrega)",
        items: [
          {
            label: "¿Qué muestra?",
            description:
              "Por cada proveedor, cuántos días tarda en promedio (y en el mejor/peor caso) desde que le hacés una orden hasta que confirmás la recepción. Se calcula solo con el historial de órdenes ya recibidas — necesitás algunas para que aparezcan datos.",
          },
        ],
      },
      {
        title: "Inflación de costos",
        items: [
          {
            label: "¿Qué muestra?",
            description:
              "Compara el costo con el que compraste un producto la primera vez contra el más reciente, por proveedor, y te muestra el % de variación. Útil para detectar aumentos fuertes y renegociar o buscar otro proveedor.",
          },
        ],
      },
      {
        title: "Score de Riesgo",
        items: [
          {
            label: "¿Qué muestra?",
            description:
              "Clasifica a cada proveedor en riesgo alto, medio o bajo según su cumplimiento histórico (demoras, variación de precios, etc.). Necesitás al menos 2 órdenes recibidas de un proveedor para que aparezca su score — los datos se acumulan solos con el uso.",
          },
        ],
      },
    ],
  },

  categorias: {
    title: "Categorías y marcas — Ordenar el catálogo",
    intro:
      "Acá organizás cómo se agrupan tus productos: por categoría (Bebidas, Almacén, Limpieza…) y por marca. Sirve para filtrar en Productos y para los reportes por categoría.",
    sections: [
      {
        title: "Categorías",
        items: [
          {
            label: "Botón '+ Nueva categoría'",
            description:
              "Creá una categoría vacía de antemano, para poder asignarla después a tus productos desde Productos. También se crean solas si escribís una categoría nueva directamente al cargar un producto.",
          },
          {
            label: "Ver productos",
            description:
              "Te lleva a Productos ya filtrado por esa categoría.",
          },
          {
            label: "Renombrar",
            description:
              "Cambia el nombre en todos los productos que la tengan asignada de una sola vez — útil para corregir un typo o unificar dos categorías escritas distinto.",
          },
          {
            label: "Eliminar",
            description:
              "Borra la categoría. Los productos que la tenían no se borran, quedan sin categoría asignada (podés volver a asignarles una desde Productos).",
          },
          {
            label: "'(sin categoria)'",
            description:
              "Es un grupo automático, no una categoría real — junta a los productos que todavía no tienen ninguna asignada. No se puede renombrar ni borrar.",
          },
        ],
      },
      {
        title: "Marcas",
        items: [
          {
            label: "Solo existen las que ya usás",
            description:
              "A diferencia de las categorías, no hay botón para crear una marca vacía: aparecen solas apenas escribís una marca nueva en un producto.",
          },
          {
            label: "Renombrar para unificar duplicados",
            description:
              "Si tenés la misma marca escrita de formas distintas (ej. 'coca cola' y 'Coca-Cola'), renombrá una hacia la otra para que todos esos productos queden agrupados bajo un solo nombre.",
          },
        ],
      },
    ],
  },

  vencimientos: {
    title: "Vencimientos — Control de lotes por fecha",
    intro:
      "Cada fila acá es un lote de mercadería con su propia fecha de vencimiento (no el producto en general) — así podés tener, por ejemplo, dos partidas del mismo yogur con fechas distintas.",
    sections: [
      {
        title: "Cómo leer la pantalla",
        items: [
          {
            label: "Colores por urgencia",
            description:
              "Violeta = ya venció. Naranja = vence en 3 días o menos. Amarillo fuerte = 7 días o menos. Amarillo claro = dentro del mes. Gris = más adelante, dentro del rango que elegiste.",
          },
          {
            label: "'Mostrar hasta'",
            description:
              "Elegí la ventana de tiempo (30, 60 o 90 días) para ver lotes que vencen dentro de ese plazo. 'Actualizar' vuelve a consultar con el filtro actual.",
          },
        ],
      },
      {
        title: "Cargar lotes",
        items: [
          {
            label: "Botón '+ Agregar lote'",
            description:
              "Cargá manualmente un lote con producto, cantidad, costo unitario, fecha de vencimiento (opcional) y notas — por ejemplo, para asentar una partida que llegó con fecha distinta a la que ya tenías en stock.",
          },
          {
            label: "Botón de editar (lápiz) en cada lote",
            description:
              "Corrige la fecha de vencimiento de un lote ya cargado, si la ingresaste mal o cambió.",
          },
        ],
      },
      {
        title: "Dar de baja mercadería vencida",
        items: [
          {
            label: "Botón 'Retirar'",
            description:
              "Saca del stock las unidades de ese lote específico (por ejemplo, porque venció y la tirás). Te pide confirmación antes de descontar el stock.",
          },
        ],
      },
      {
        title: "Reponer",
        items: [
          {
            label: "📋 Generar órdenes de compra",
            description:
              "Es el mismo generador automático que en Proveedores → Proyección 7 días: arma órdenes de compra para los productos con stock bajo, agrupadas por proveedor. Si no tenés productos con stock bajo vinculados a un proveedor, te avisa que no generó ninguna.",
          },
        ],
      },
    ],
  },

  etiquetas: {
    title: "Etiquetas — Carteles y códigos de barra para góndola",
    intro:
      "Armá e imprimí etiquetas de precio, cartel de góndola o planillas de código de barras para tus productos, adaptadas al papel o rollo térmico que uses.",
    sections: [
      {
        title: "Elegir productos",
        items: [
          {
            label: "Buscador de productos",
            description:
              "Buscá por nombre o código y agregalos a la tanda a imprimir. Podés armar una lista con varios productos distintos y cantidades diferentes para cada uno.",
          },
          {
            label: "Productos pesables",
            description:
              "Si el producto se vende por peso, podés dejarlo sin peso cargado (imprime el cartel de precio por kilo/unidad) o cargarle un peso puntual, para la etiqueta de un paquete ya pesado con su total calculado.",
          },
          {
            label: "⚠ Bajo stock",
            description:
              "Agrega de una sola vez todos los productos con stock por debajo del mínimo — útil para reimprimir carteles de una tanda de reposición.",
          },
        ],
      },
      {
        title: "Plantilla",
        items: [
          {
            label: "Góndola",
            description: "Nombre, precio grande y código de barras — la más usada para estantería.",
          },
          {
            label: "Precio",
            description: "Etiqueta chica con el precio bien destacado, para góndolas con poco espacio.",
          },
          {
            label: "Completa",
            description: "Incluye toda la información disponible del producto.",
          },
          {
            label: "Código de barras",
            description: "Una hoja solo con códigos de barra, para reponer etiquetas que se despegaron o dañaron.",
          },
        ],
      },
      {
        title: "Opciones",
        items: [
          {
            label: "Lista de precios",
            description:
              "Elegí con qué precio imprimir (minorista, mayorista o especial), según a qué góndola o cliente van dirigidas.",
          },
          {
            label: "Mostrar vencimiento / categoría / nombre del negocio",
            description:
              "Sumá o sacá esos datos de la etiqueta según lo que necesites mostrarle al cliente.",
          },
          {
            label: "Texto extra",
            description:
              "Un cartel corto que se imprime en todas las etiquetas de esta tanda, como 'OFERTA', '2x1' o 'Llevando 2, 50% off'.",
          },
        ],
      },
      {
        title: "Tamaño de etiqueta y papel",
        items: [
          {
            label: "Papel: A4, Carta o Térmica 58mm",
            description:
              "Elegí según tu impresora — A4/Carta para impresoras comunes de oficina, Térmica 58mm para impresoras de rollo dedicadas a etiquetas.",
          },
          {
            label: "Ancho y alto en milímetros",
            description:
              "Configurá el tamaño exacto de tu etiqueta, o tocá uno de los tamaños comunes de impresoras térmicas (30×20, 40×30, 50×25, etc.) para no tener que medir.",
          },
          {
            label: "Tamaño de letra",
            description: "Chico, normal o grande — útil si el nombre del producto no entra bien en la etiqueta.",
          },
        ],
      },
      {
        title: "Imprimir",
        items: [
          {
            label: "Vista previa",
            description:
              "Mirá cómo va a quedar cada etiqueta antes de imprimir — se actualiza sola con cualquier cambio de plantilla, tamaño u opciones.",
          },
          {
            label: "Botón '🖨️ Imprimir'",
            description:
              "Genera todas las etiquetas de la tanda (según la cantidad que le pusiste a cada producto) y abre el diálogo de impresión de tu sistema.",
          },
        ],
      },
    ],
  },

  combos: {
    title: "Combos y packs — Vender varios productos como uno solo",
    intro:
      "Armá combinaciones a un precio fijo (ej. 'Combo Mate + Galletitas') para venderlas desde Caja escaneando un solo código, en vez de cargar cada producto por separado.",
    sections: [
      {
        title: "Crear un combo",
        items: [
          {
            label: "Botón '+ Nuevo combo'",
            description:
              "Nombre y precio del combo son obligatorios. El código de barras es opcional — podés escribirlo o generarlo al azar con el botón 🎲 para pegarle una etiqueta impresa.",
          },
          {
            label: "Componentes (opcional)",
            description:
              "Si el combo se arma con productos que ya tenés cargados, agregalos con cantidades — al venderlo, se descuenta el stock de cada componente automáticamente. Si lo dejás vacío, se vende como un ítem de precio fijo que no toca ningún stock.",
          },
          {
            label: "Comparación de precio",
            description:
              "El sistema te muestra cuánto sale comprar los componentes por separado, cuánto ahorra el cliente eligiendo el combo, y el margen que te queda a vos. Si el combo termina siendo más caro que por separado, te avisa con un cartel de advertencia.",
          },
        ],
      },
      {
        title: "Administrar combos",
        items: [
          {
            label: "Activar / Desactivar",
            description:
              "Un combo inactivo deja de aparecer en Caja para vender, pero no se borra — podés reactivarlo cuando quieras.",
          },
          {
            label: "Eliminar",
            description:
              "Borra el combo definitivamente. No se puede deshacer.",
          },
        ],
      },
      {
        title: "Apagar la función",
        items: [
          {
            label: "'Desactivar combos'",
            description:
              "Si no usás combos, podés apagar toda la función desde acá o desde Configuración → General. Se oculta el link del menú y el botón de combos en Caja, sin perder los combos ya creados.",
          },
        ],
      },
    ],
  },

  presupuestos: {
    title: "Presupuestos — Cotizar sin vender todavía",
    intro:
      "Armá una cotización para un cliente sin que sea una venta ni una factura — la podés imprimir, hacerle seguimiento, y convertirla en una venta real el día que el cliente confirma.",
    sections: [
      {
        title: "Crear un presupuesto",
        items: [
          {
            label: "Botón 'Nuevo presupuesto'",
            description:
              "Agregás líneas buscando productos de tu catálogo, o escribiendo una descripción libre con precio manual (para algo que no está cargado como producto). Cada línea admite cantidad y un descuento en % propio.",
          },
          {
            label: "Descuento general y notas",
            description:
              "Además del descuento por línea, podés aplicar uno al total del presupuesto, y agregar notas o condiciones (por ejemplo, forma de pago o validez de precios).",
          },
          {
            label: "Válido hasta",
            description:
              "Fecha límite de la cotización. Pasada esa fecha, el presupuesto se muestra como 'Vencido' aunque nadie lo haya tocado — no hace falta actualizarlo a mano.",
          },
        ],
      },
      {
        title: "Estados",
        items: [
          {
            label: "Borrador → Enviado → Aprobado / Rechazado",
            description:
              "Vas cambiando el estado a mano a medida que avanza la negociación con el cliente, para llevar un registro de en qué quedó cada cotización.",
          },
          {
            label: "Vencido",
            description:
              "Se calcula solo a partir de la fecha 'Válido hasta' — no necesita que nadie lo marque.",
          },
        ],
      },
      {
        title: "Convertir en venta",
        items: [
          {
            label: "Botón 'Convertir en venta'",
            description:
              "Carga todos los productos del presupuesto directamente en el carrito de Caja, listos para cobrar — no hace falta volver a tipearlos.",
          },
          {
            label: "Si el presupuesto ya venció",
            description:
              "El sistema te avisa antes de convertirlo, por si los precios cambiaron desde que lo armaste. Podés confirmar igual si el cliente acepta los precios originales.",
          },
        ],
      },
      {
        title: "Otras acciones",
        items: [
          {
            label: "Imprimir",
            description:
              "Genera un presupuesto imprimible con el detalle, el total y la fecha de validez, para entregarle al cliente.",
          },
          {
            label: "Eliminar",
            description:
              "Borra el presupuesto por completo. No se puede deshacer.",
          },
        ],
      },
    ],
  },

  promociones: {
    title: "Promociones — Descuentos que se aplican solos en Caja",
    intro:
      "Configurá acá descuentos automáticos: se aplican solos en Caja cuando corresponde, sin que el cajero tenga que acordarse de nada.",
    sections: [
      {
        title: "Tipos de promoción",
        items: [
          {
            label: "% Descuento",
            description: "Un porcentaje de descuento sobre el precio.",
          },
          {
            label: "$ Fijo",
            description: "Un monto fijo en pesos de descuento.",
          },
          {
            label: "2×1 y 3×2",
            description: "Lleva 2 y paga 1, o lleva 3 y paga 2 — el sistema calcula solo cuál conviene cobrar como gratis/con descuento.",
          },
        ],
      },
      {
        title: "A qué se aplica",
        items: [
          {
            label: "Todo el comercio",
            description: "El descuento se aplica a cualquier venta, sin importar qué productos lleve.",
          },
          {
            label: "Una categoría",
            description: "Se aplica solo a productos de una categoría puntual (ej: 'Bebidas -10%').",
          },
          {
            label: "Un producto",
            description: "Se aplica solo a un producto específico.",
          },
        ],
      },
      {
        title: "Cartel para la góndola",
        items: [
          {
            label: "Botón '🏷️ Cartel'",
            description:
              "Cada promoción tiene su cartel listo para imprimir y pegar en la góndola o en la vidriera, así el cliente se entera. Muestra la promo bien grande, el producto, el precio de antes y el de ahora, los días y horarios, y hasta cuándo vale. Elegís hoja entera, media hoja o etiqueta chica para el estante.",
          },
          {
            label: "Al crear la promoción",
            description:
              "Tocá '🏷️ Crear y ver cartel' en vez de 'Crear' y se abre el cartel apenas se guarda — en dos clics la tenés impresa.",
          },
        ],
      },
      {
        title: "Vigencia y condiciones avanzadas",
        items: [
          {
            label: "Válida desde / hasta (fecha)",
            description:
              "Definí el rango de fechas en que la promoción está activa — útil para ofertas de temporada o fin de semana largo.",
          },
          {
            label: "Condiciones avanzadas (horario, días, cantidad)",
            description:
              "Desplegá esta sección para restringir aún más: días de la semana concretos (si lo dejás vacío, aplica todos los días), un horario del día (ej: solo de 18 a 21hs), y una cantidad mínima en el carrito para que dispare el descuento.",
          },
        ],
      },
      {
        title: "Estados",
        items: [
          {
            label: "Activas",
            description: "Las que están funcionando ahora mismo en Caja.",
          },
          {
            label: "Expiradas",
            description: "Su fecha de fin ya pasó — dejaron de aplicarse solas, pero quedan guardadas por si querés reactivarlas cambiando la fecha.",
          },
          {
            label: "Inactivas",
            description: "Las que apagaste manualmente con el interruptor de activar/desactivar.",
          },
        ],
      },
    ],
  },

  facturacion: {
    title: "Facturación (ARCA) — Facturas electrónicas",
    intro:
      "Emitís facturas A, B y C electrónicas directamente ante ARCA (ex AFIP) desde acá, sin intermediarios. Tiene dos partes: la lista de facturas ya emitidas, y la configuración inicial (una sola vez por negocio).",
    sections: [
      {
        title: "Cómo se generan las facturas",
        items: [
          {
            label: "Automáticas o manuales",
            description:
              "Una vez que la Facturación Electrónica está configurada y funcionando, cada venta que hacés en Caja genera su factura sola — no tenés que hacer nada extra al vender. Si preferís decidir venta por venta, en Configuración ARCA → '¿Cuándo se hace la factura?' elegí 'Manual': al terminar la venta aparece el botón 'Facturar con ARCA' (tecla F) y solo se factura si lo tocás.",
          },
          {
            label: "Botón '+ Nueva factura'",
            description:
              "Para emitir una factura suelta que no viene de una venta registrada en Caja (por ejemplo, un servicio cobrado aparte).",
          },
        ],
      },
      {
        title: "Estados de una factura",
        items: [
          {
            label: "Pendiente",
            description:
              "Todavía no se pudo mandar a ARCA (normalmente porque no había internet en ese momento). Usá el botón '↻ Reintentar' cuando vuelva la conexión.",
          },
          {
            label: "Autorizada",
            description: "ARCA ya le dio el CAE (código de autorización) — la factura es válida.",
          },
          {
            label: "Error",
            description:
              "ARCA rechazó el intento. Podés reintentarla desde el botón '🔄 Reintentar' en esa fila.",
          },
        ],
      },
      {
        title: "Anular una factura",
        items: [
          {
            label: "Botón 'Anular'",
            description:
              "Solo disponible para facturas ya autorizadas. Emite una Nota de Crédito que la deja sin efecto ante ARCA — no borra la factura original, queda el rastro de ambas.",
          },
          {
            label: "Vía Devoluciones",
            description:
              "Si estás procesando la devolución de una venta con factura, no hace falta venir hasta acá: el módulo de Devoluciones emite la nota de crédito automáticamente al confirmar.",
          },
        ],
      },
      {
        title: "Configurar la Facturación Electrónica",
        items: [
          {
            label: "El indicador de 3 pasos",
            description:
              "La pantalla te guía paso a paso (Datos → Certificado → Verificar) y te dice en criollo, arriba de todo, qué te falta para terminar. Podés volver a un paso ya hecho para corregir algo cuando quieras.",
          },
          {
            label: "💬 ¿Necesitás ayuda?",
            description:
              "Si te trabás en cualquier paso de la configuración con ARCA, este botón te abre un WhatsApp directo con soporte.",
          },
          {
            label: "🗑️ Borrar configuración y facturas de ARCA",
            description:
              "Solo para administradores. Borra el CUIT, el certificado y todo el historial de facturas guardado en esta computadora, para volver a configurar todo desde cero. No afecta nada de tu ARCA real — es solo lo guardado localmente.",
          },
        ],
      },
    ],
  },

  usuarios: {
    title: "Usuarios y Permisos — Quién entra y qué puede hacer",
    intro:
      "Creá un usuario por cada persona que trabaja con el sistema. Sirve para separar accesos y saber quién hizo cada acción, incluso si tenés una sola caja.",
    sections: [
      {
        title: "Roles",
        items: [
          {
            label: "Administrador",
            description: "Acceso completo, incluido este módulo (Usuarios) y Configuración.",
          },
          {
            label: "Supervisor",
            description: "Todo el sistema excepto Usuarios y Configuración — puede autorizar descuentos grandes en Caja y usar los módulos de gestión.",
          },
          {
            label: "Cajero",
            description: "Solo puede entrar a Caja para vender. No ve reportes, productos ni ningún módulo administrativo.",
          },
        ],
      },
      {
        title: "Crear y administrar",
        items: [
          {
            label: "Contraseña",
            description:
              "Mínimo 4 caracteres. La persona puede cambiarla ella misma después desde su usuario, o un admin/supervisor puede resetearla desde 'Cambiar contraseña'.",
          },
          {
            label: "Desactivar",
            description:
              "La persona deja de poder iniciar sesión, pero su usuario y su historial de acciones quedan guardados. Se puede reactivar en cualquier momento.",
          },
        ],
      },
      {
        title: "Usuarios vs. Multicaja",
        items: [
          {
            label: "¿Sirve esto con una sola caja?",
            description:
              "Sí — los usuarios separan accesos y trazabilidad ('quién hizo esta venta') aunque tengas una única computadora vendiendo.",
          },
          {
            label: "¿Y si sumo otra caja?",
            description:
              "Si en algún momento activás Multicaja (varias computadoras vendiendo a la vez) desde Configuración, los usuarios que ya creaste funcionan igual en todas las cajas conectadas — no hace falta cargarlos de nuevo.",
          },
        ],
      },
    ],
  },

  dashboard: {
    title: "Dashboard — El resumen de tu negocio de un vistazo",
    intro:
      "Es la pantalla de inicio: ventas de hoy, cómo venís contra tus metas, qué se vende más, y las alertas y consejos que necesitan tu atención.",
    sections: [
      {
        title: "Ventas de hoy",
        items: [
          {
            label: "Comparación 'vs. [día] pasado'",
            description:
              "Compara la venta de hoy contra el mismo día de la semana anterior (ej: este martes vs. el martes pasado), no contra ayer — así la comparación tiene sentido aunque los fines de semana vendas distinto que entre semana.",
          },
          {
            label: "Transacciones, ticket promedio y ganancia bruta",
            description:
              "Además del total vendido, ves cuántas ventas hiciste, cuánto gastó en promedio cada cliente, y cuánta ganancia real te deja el día (ventas menos costo de lo vendido).",
          },
        ],
      },
      {
        title: "Metas",
        items: [
          {
            label: "Metas diaria, semanal, mensual y anual",
            description:
              "Si configuraste algún objetivo de venta en Configuración, acá ves una barra de progreso de cuánto llevás contra esa meta. Las metas que no configuraste no se muestran.",
          },
        ],
      },
      {
        title: "Tendencia y ranking",
        items: [
          {
            label: "Tendencia últimos 7 días",
            description: "Un gráfico simple de cuánto vendiste cada uno de los últimos 7 días, para ver de un vistazo si la semana viene mejor o peor que la anterior.",
          },
          {
            label: "Top productos hoy",
            description: "Los productos que más se vendieron en el día — útil para saber qué reponer con prioridad.",
          },
        ],
      },
      {
        title: "Alertas y Consejo del día",
        items: [
          {
            label: "Panel de Alertas",
            description:
              "Junta en un solo lugar avisos de stock crítico, productos por vencer y cuentas corrientes vencidas, cada uno con un enlace directo al módulo donde podés actuar (Proveedores, Vencimientos o Clientes).",
          },
          {
            label: "💡 Consejo del día",
            description:
              "Muestra los avisos automáticos más importantes del sistema (más variados que solo stock/vencimientos/deuda: caja abierta hace muchas horas, facturas ARCA con error, licencia por vencer, y más). Podés descartarlos por hoy o para siempre, y reactivarlos desde Configuración.",
          },
        ],
      },
    ],
  },

  reportes: {
    title: "Reportes — Análisis a fondo de tu negocio",
    intro:
      "Elegí un período (Hoy, Ayer, 7 días, Este mes o uno personalizado) y recorré las pestañas para ver tus ventas desde distintos ángulos.",
    sections: [
      {
        title: "Resumen",
        items: [
          {
            label: "Por medio de pago / por categoría",
            description: "Cuánto entró en cada forma de pago (efectivo, débito, QR, etc.) y qué categorías de productos vendieron más, en el período elegido.",
          },
          {
            label: "Productos más vendidos / Ventas por empleado",
            description: "El ranking de productos del período, y — si tenés varios usuarios cargados — cuánto vendió cada uno.",
          },
        ],
      },
      {
        title: "Ventas",
        items: [
          {
            label: "La lista completa",
            description: "Cada venta del período con fecha, monto y forma de pago.",
          },
          {
            label: "Botón 'Ver'",
            description: "Abre el detalle completo de esa venta, con la opción de '🖨 Reimprimir ticket' si el cliente necesita otra copia.",
          },
        ],
      },
      {
        title: "Márgenes",
        items: [
          {
            label: "Margen por categoría / por producto",
            description: "Cuánta ganancia real (no solo venta) te deja cada categoría o producto, para detectar qué te conviene empujar más y qué está casi sin margen.",
          },
        ],
      },
      {
        title: "Stock $",
        items: [
          {
            label: "Valor al costo vs. valor de venta",
            description: "Cuánto dinero tenés inmovilizado en mercadería ahora mismo (a precio de costo) y cuánto valdría si vendieras todo ese stock al precio normal.",
          },
        ],
      },
      {
        title: "Reposición",
        items: [
          {
            label: "Productos bajo el mínimo, agrupados por proveedor",
            description: "Lista lista para armar el pedido: qué falta, cuánto pedir de cada uno, y el costo estimado — agrupado por proveedor para llamar a cada uno de una vez.",
          },
        ],
      },
      {
        title: "Libro IVA",
        items: [
          {
            label: "Neto e IVA de cada venta",
            description: "El desglose impositivo de todas las ventas del período, listo para tu contador. Exportá a Excel con el botón '📊 Exportar Excel'.",
          },
          {
            label: "Origen: Real (AFIP) vs. Estimado",
            description: "Si la venta tiene una factura ARCA autorizada, el IVA es el real que declaró AFIP. Si no, es un cálculo estimado según la tasa configurada — tu contador necesita saber cuál es cuál.",
          },
        ],
      },
      {
        title: "Afinidad",
        items: [
          {
            label: "Qué productos se compran juntos",
            description: "Analiza los últimos 60 días de ventas y te muestra pares de productos que aparecen juntos en el carrito seguido, con el % de veces que pasa. Útil para decidir qué poner cerca en la góndola o qué ofrecer combinado.",
          },
        ],
      },
    ],
  },

  auditoria: {
    title: "Auditoría — Quién hizo qué",
    intro:
      "Un registro de acciones importantes en el sistema: altas, bajas, ediciones, ventas anuladas, ajustes de stock, aperturas/cierres de caja y más, con quién y cuándo.",
    sections: [
      {
        title: "Filtrar",
        items: [
          {
            label: "Buscador",
            description: "Buscá por usuario, tipo de acción o detalle.",
          },
          {
            label: "Rango de fechas",
            description: "Acotá el registro a un período puntual con 'Desde' y 'Hasta'.",
          },
          {
            label: "Pestañas por tipo",
            description: "Filtrá rápido por Productos, Ventas, Devoluciones, Caja, Stock, Usuarios o Sistema (config. ARCA y Configuración general).",
          },
        ],
      },
      {
        title: "Leer una entrada",
        items: [
          {
            label: "Colores por tipo de acción",
            description: "Verde = alta/reactivación. Azul = edición. Naranja = baja/anulación/desactivación. Amarillo = ajustes de stock o conteo. Violeta = cambios masivos.",
          },
          {
            label: "Exportar Excel",
            description: "Descargá el registro filtrado a un archivo .xlsx — útil para revisar con calma o guardar como respaldo de gestión.",
          },
        ],
      },
    ],
  },

  configuracion: {
    title: "Configuración — Ajustes generales del sistema",
    intro:
      "Acá vive todo lo que configurás una sola vez (o casi): datos del negocio, funciones opcionales, metas, respaldos, licencia y Multicaja. Solo accesible para administradores.",
    sections: [
      {
        title: "Pestaña General",
        items: [
          {
            label: "🏪 Datos del negocio",
            description: "Nombre y datos que aparecen en tickets y presupuestos.",
          },
          {
            label: "⚙️ Funciones opcionales",
            description: "Prendé o apagá 'Controlar stock' y 'Combos y packs' según los uses o no — apagarlas simplifica la app para negocios que no las necesitan.",
          },
          {
            label: "💡 Consejo del día y ❓ Botones de ayuda",
            description: "Interruptores generales para los avisos automáticos del sistema y para estos mismos botones de ayuda — se pueden apagar del todo y reactivar acá cuando quieras.",
          },
          {
            label: "🧾 Ticket / 💲 Listas de precios / ⚡ Botones rápidos",
            description: "El mensaje al pie del ticket, los nombres de tus 3 listas de precio (minorista/mayorista/especial), y los botones de venta rápida para artículos sin código (bolsas, envases, etc.).",
          },
        ],
      },
      {
        title: "Pestaña Finanzas",
        items: [
          {
            label: "🎯 Metas y objetivos",
            description: "Metas de venta diaria, semanal, mensual y anual — las que cargues acá aparecen con barra de progreso en el Dashboard.",
          },
          {
            label: "📊 Costos y márgenes",
            description: "Gastos fijos mensuales, margen mínimo aceptable y tasa de IVA. Con los gastos fijos cargados, el sistema calcula solo tu punto de equilibrio diario estimado.",
          },
          {
            label: "🔒 Control de descuentos en Caja",
            description: "El % de descuento a partir del cual Caja le exige al cajero el usuario y contraseña de un supervisor o admin antes de cobrar.",
          },
          {
            label: "💳 Comisiones por método de pago",
            description: "Opcional. No cambia el precio al cliente — solo se usa para calcular tu ganancia real en Reportes, descontando lo que se lleva cada medio de pago.",
          },
        ],
      },
      {
        title: "Pestaña Respaldo",
        items: [
          {
            label: "Para qué sirve",
            description: "Guarda una copia completa de tu negocio (ventas, productos, clientes, config. de ARCA) por si cambiás de computadora o se rompe la actual. La pantalla te guía en 3 pasos.",
          },
          {
            label: "Guardar en una carpeta de nube",
            description: "Elegí una carpeta de OneDrive/Drive/Dropbox para que el backup se sincronice solo — si no lo hacés, la copia vive solo en esta computadora.",
          },
          {
            label: "Restaurar",
            description: "Reemplaza TODOS los datos actuales por los del backup elegido. Usalo solo al migrar a una compu nueva o para volver atrás ante un problema grave — no es para uso cotidiano.",
          },
        ],
      },
      {
        title: "Pestaña Sistema",
        items: [
          {
            label: "🖥️ Multicaja",
            description: "Conectá varias computadoras vendiendo con el mismo stock: una hace de 'servidor' (te da una dirección y un código), y las demás se conectan como 'cliente' con esos datos.",
          },
          {
            label: "🔑 Licencia",
            description: "Estado de tu prueba gratis o licencia completa, y el campo para activar un código nuevo cuando compres.",
          },
          {
            label: "ℹ️ Acerca del sistema",
            description: "Versión instalada y botón para buscar actualizaciones manualmente.",
          },
        ],
      },
    ],
  },

  productos: {
    title: "Productos — Cómo administrar tu catálogo",
    intro:
      "Acá cargás y administrás todos los productos de tu negocio: nombres, precios, costos, stock, códigos de barras y más.",
    sections: [
      {
        title: "La lista de productos",
        items: [
          {
            label: "¿Qué información se ve?",
            description:
              "Por cada producto se muestra el código de barras, el nombre, el costo, el precio de venta con el margen de ganancia en porcentaje, el stock actual y la velocidad de venta.",
          },
          {
            label: "Margen en amarillo o rojo",
            description:
              "Si el margen de ganancia de un producto es muy bajo (por ejemplo, estás vendiendo casi al costo), el sistema te avisa con un cartelito amarillo o rojo. Conviene revisar ese precio.",
          },
          {
            label: "Velocidad de venta (días restantes)",
            description:
              "El sistema analiza cuánto se vende por día y te muestra cuántos días de stock te quedan. Si aparece en verde hay stock suficiente; amarillo es aviso; rojo es urgente.",
          },
          {
            label: "Icono 💰 'Costo ↑ revisar'",
            description:
              "Aparece cuando el costo de un producto subió pero el precio de venta no se actualizó. Es una alerta para que revisés si tu precio sigue siendo rentable.",
          },
        ],
      },
      {
        title: "Crear un producto nuevo",
        items: [
          {
            label: "Botón 'Nuevo producto'",
            description:
              "Hacé clic en el botón verde arriba a la derecha. Se abre un formulario donde completás: nombre (obligatorio), código de barras, costo, precio minorista, precio mayorista, precio especial, stock actual, stock mínimo, categoría y fecha de vencimiento.",
          },
          {
            label: "¿Qué es el stock mínimo?",
            description:
              "Es la cantidad mínima que querés tener en stock. Cuando el stock baja de ese número, el sistema te avisa en la pestaña 'Alertas' para que hagas un pedido a tiempo.",
          },
          {
            label: "Producto pesable",
            description:
              "Si un producto se vende por peso (por ejemplo, fiambre o queso), tildá la opción 'Se vende por peso'. Así el sistema sabe que la cantidad puede ser decimal.",
          },
        ],
      },
      {
        title: "Editar y borrar",
        items: [
          {
            label: "Editar un producto",
            description:
              "Hacé clic en el botón 'Editar' que aparece en la fila del producto. Se abre el mismo formulario que al crear, con todos los datos cargados para que los modifiques.",
          },
          {
            label: "Borrar un producto",
            description:
              "El botón 'Borrar' elimina el producto permanentemente. Usalo con cuidado: una vez borrado no se puede recuperar.",
          },
        ],
      },
      {
        title: "Stock",
        items: [
          {
            label: "Ajustar el stock (botón 'Stock')",
            description:
              "Si recibiste mercadería, encontraste un error o hiciste un conteo físico, usá este botón. Ingresás la cantidad real y el sistema guarda el cambio con fecha y hora en el historial.",
          },
          {
            label: "Ver el historial de movimientos",
            description:
              "El botón 'Historial' te muestra todos los movimientos de stock de ese producto: ventas realizadas, ingresos de mercadería y ajustes manuales.",
          },
        ],
      },
      {
        title: "Las pestañas",
        items: [
          {
            label: "Todos",
            description: "La lista completa de todos tus productos. Podés buscar por nombre o código de barras y filtrar por categoría.",
          },
          {
            label: "Alertas",
            description:
              "Muestra solo los productos que tienen el stock por debajo del mínimo que configuraste. Son los que necesitás reponer cuanto antes.",
          },
          {
            label: "Sin movimiento",
            description:
              "Productos que no tuvieron ninguna venta en los últimos 30 días. También muestra cuánto capital tenés inmovilizado en esa mercadería parada. Útil para hacer ofertas o liquidaciones.",
          },
          {
            label: "Stock mín. IA",
            description:
              "El sistema analiza la velocidad de venta de cada producto y te sugiere cuánto debería ser el stock mínimo. Podés aceptar las sugerencias con un clic y se aplican automáticamente.",
          },
          {
            label: "Impacto de precio",
            description:
              "Muestra los productos con margen de ganancia bajo y te dice cuánto ganarías por mes si ajustás el precio al nivel recomendado. Podés actualizar el precio desde ahí mismo.",
          },
        ],
      },
      {
        title: "Importar y exportar",
        items: [
          {
            label: "Importar desde CSV o Excel",
            description:
              "Si tenés un listado de productos en una planilla de Excel, podés subirlo directamente con el botón 'Importar CSV/Excel'. El archivo debe tener al menos una columna llamada 'nombre'. También acepta columnas de precio, costo, stock y código de barras.",
          },
          {
            label: "Exportar a Excel",
            description:
              "El botón 'Exportar Excel' descarga toda tu lista de productos en un archivo .xlsx. Útil para revisar, imprimir o compartir con tu contador.",
          },
        ],
      },
      {
        title: "Actualización masiva de precios",
        items: [
          {
            label: "Subir precios de golpe",
            description:
              "El botón 'Actualizar precios' te permite subir (o bajar) los precios de todos los productos a la vez, aplicando un porcentaje. Por ejemplo: si los proveedores subieron 15%, ponés 15 y se actualiza todo de una vez.",
          },
          {
            label: "Filtrar por categoría o proveedor",
            description:
              "No necesitás aplicar el aumento a todo. Podés elegir que solo afecte a una categoría (ej: 'Bebidas') o a un proveedor específico.",
          },
          {
            label: "Vista previa antes de confirmar",
            description:
              "Antes de aplicar el cambio, el sistema te muestra una lista con los precios actuales y los nuevos para que puedas revisar. Recién cuando confirmás se guardan los cambios.",
          },
        ],
      },
    ],
  },

  inventario: {
    title: "Inventario — Conteo físico de stock",
    intro:
      "El conteo de inventario te permite comparar lo que dice el sistema con lo que tenés físicamente en el negocio. Es ideal hacerlo una vez por semana o al cierre del mes.",
    sections: [
      {
        title: "¿Para qué sirve?",
        items: [
          {
            label: "Corregir diferencias de stock",
            description:
              "A veces el stock del sistema no coincide con lo que tenés en la góndola. Puede pasar por roturas, pérdidas, robos o errores al cargar una venta. El conteo detecta esas diferencias y las corrige de una sola vez.",
          },
        ],
      },
      {
        title: "Paso 1: Iniciar el conteo",
        items: [
          {
            label: "Hacé clic en 'Iniciar conteo'",
            description:
              "El sistema carga todos los productos activos con el stock que tiene registrado en este momento. A partir de acá empezás a recorrer el negocio.",
          },
        ],
      },
      {
        title: "Paso 2: Contar físicamente",
        items: [
          {
            label: "Ingresá la cantidad que contás",
            description:
              "Por cada producto, escribí en la columna 'Cantidad contada' las unidades que tenés físicamente en el negocio. No hace falta completar todos — solo los que contés.",
          },
          {
            label: "Campo en amarillo",
            description:
              "Si lo que escribiste es diferente al stock del sistema, el campo se pone en amarillo automáticamente para que lo veas de un vistazo.",
          },
          {
            label: "Filtrar para ir de a poco",
            description:
              "Si el negocio tiene muchos productos, podés usar el buscador o el filtro de categoría para ir contando de a una sección por vez (primero bebidas, después lácteos, etc.).",
          },
        ],
      },
      {
        title: "Paso 3: Revisar las diferencias",
        items: [
          {
            label: "Hacé clic en 'Ver diferencias →'",
            description:
              "Cuando terminás de contar, este botón te muestra solo los productos donde hay diferencia entre lo que contaste y lo que dice el sistema.",
          },
          {
            label: "Número en verde",
            description:
              "Hay más unidades físicas que en el sistema. Puede ser que ingresaste mercadería y no se registró correctamente.",
          },
          {
            label: "Número en rojo",
            description:
              "Hay menos unidades físicas que en el sistema. Puede deberse a rotura, pérdida, robo o un error al cargar una venta.",
          },
          {
            label: "Volver a contar",
            description:
              "Si encontrás algo raro, usá el botón '← Volver a contar' para corregir los números antes de aplicar.",
          },
        ],
      },
      {
        title: "Paso 4: Aplicar los ajustes",
        items: [
          {
            label: "Botón 'Aplicar'",
            description:
              "Si estás conforme con lo que revisaste, hacé clic en 'Aplicar'. El stock del sistema se actualiza automáticamente para que coincida con el conteo físico.",
          },
          {
            label: "Atención: esta acción no se puede deshacer",
            description:
              "Una vez que aplicás el conteo, los stocks quedan actualizados y no hay forma de revertirlo. Asegurate de haber revisado bien las diferencias antes de confirmar.",
          },
          {
            label: "¿Qué pasa si no hay diferencias?",
            description:
              "Si todo coincide, el sistema te avisa que el stock ya está correcto y no hace ningún cambio.",
          },
        ],
      },
    ],
  },
};
