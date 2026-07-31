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
              "Cuando tenés todos los productos en el carrito, hacé clic en el botón azul grande que dice 'Cobrar', o presioná Enter con el buscador vacío, o F2. Se abre una ventana donde elegís cómo paga el cliente: efectivo, tarjeta, transferencia, cuenta corriente o combinado. Si en tu teclado F2 no responde sin apretar Fn, usá Enter — funciona igual en cualquier teclado.",
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
