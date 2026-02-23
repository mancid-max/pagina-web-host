/***********************
 * ESTADO GLOBAL
 ***********************/
let productos = [];
let pedido = [];
let skuActivo = "";
let draftTallasPorSku = {}; // { "4204": {38:2,40:1}, "4204-02": {...} }

const EMAIL_DESTINO = "man.cid@mohicanojeans.cl"; // <-- cambia si quieres

/***********************
 * CARGAR PRODUCTOS
 ***********************/
fetch("data.json?v=" + Date.now())
  .then((res) => res.json())
  .then((data) => {
    productos = data;
    renderGrid(productos);
  })
  .catch((err) => console.error("Error cargando data.json:", err));

/***********************
 * UTILIDADES IMÁGENES
 ***********************/
function buildImageList(obj) {
  let imgs = [];
  if (obj?.main_image) imgs.push(obj.main_image);
  if (Array.isArray(obj?.gallery)) imgs = imgs.concat(obj.gallery);
  // quitar duplicados
  return [...new Set(imgs)];
}

function renderImages(imageList) {
  const viewer = document.getElementById("viewerImg");
  const thumbContainer = document.getElementById("thumbContainer");

  thumbContainer.innerHTML = "";

  if (!imageList || !imageList.length) {
    viewer.src = "";
    return;
  }

  viewer.src = imageList[0];

  imageList.forEach((imgSrc, index) => {
    const thumb = document.createElement("img");
    thumb.src = imgSrc;
    if (index === 0) thumb.classList.add("active-thumb");

    thumb.onclick = () => {
      viewer.src = imgSrc;
      // limpia active
      thumbContainer.querySelectorAll("img").forEach((t) => t.classList.remove("active-thumb"));
      thumb.classList.add("active-thumb");
    };

    thumbContainer.appendChild(thumb);
  });
}

/***********************
 * TALLAS: LEER/ESCRIBIR + DRAFT POR SKU
 ***********************/
function leerTallasUI() {
  const tallas = {};
  ["38", "40", "42", "44", "46", "48"].forEach((t) => {
    const el = document.getElementById("t" + t);
    const v = parseInt(el?.value || "0", 10);
    if (!isNaN(v) && v > 0) tallas[t] = v;
  });
  return tallas;
}

function escribirTallasUI(tallas = {}) {
  ["38", "40", "42", "44", "46", "48"].forEach((t) => {
    const el = document.getElementById("t" + t);
    if (!el) return;
    el.value = tallas[t] ? String(tallas[t]) : "";
  });
}

function guardarDraftDelSkuActual() {
  if (!skuActivo) return;
  draftTallasPorSku[skuActivo] = leerTallasUI();
}

function cargarDraftDelSku(sku) {
  escribirTallasUI(draftTallasPorSku[sku] || {});
}

/***********************
 * GRID
 ***********************/
function renderGrid(lista) {
  const container = document.getElementById("grid");
  container.innerHTML = lista
    .map(
      (p) => `
      <div class="card" onclick="verProducto('${p.family}')">
        <img src="${p.main_image}" alt="Modelo ${p.family}">
        <div>Modelo ${p.family}</div>
      </div>
    `
    )
    .join("");
}

/***********************
 * MODAL: ABRIR
 ***********************/
function verProducto(familyId) {
  const p = productos.find((item) => item.family === familyId);
  if (!p) return;

  // reinicia drafts para este modal (si quieres conservar entre aperturas, quita esta línea)
  document.getElementById("modalTitle").innerText = "Modelo " + p.family;

  const variantContainer = document.getElementById("variantContainer");
  variantContainer.innerHTML = "";

  // helper: activar botón
  function setActive(btn) {
    variantContainer.querySelectorAll(".variant-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  }

  // 1) Botón Familia
  const btnFamily = document.createElement("button");
  btnFamily.className = "variant-btn";
  btnFamily.innerText = "Familia " + p.family;

  btnFamily.onclick = () => {
    guardarDraftDelSkuActual();
    skuActivo = p.family;
    renderImages(buildImageList(p));
    cargarDraftDelSku(skuActivo);
    setActive(btnFamily);
  };

  variantContainer.appendChild(btnFamily);

  // 2) Botones variantes
  if (Array.isArray(p.variants) && p.variants.length) {
    p.variants.forEach((v) => {
      const btn = document.createElement("button");
      btn.className = "variant-btn";
      btn.innerText = v.sku;

      btn.onclick = () => {
        guardarDraftDelSkuActual();
        skuActivo = v.sku;
        renderImages(buildImageList(v));
        cargarDraftDelSku(skuActivo);
        setActive(btn);
      };

      variantContainer.appendChild(btn);
    });
  }

  // Estado inicial: familia activa
  skuActivo = p.family;
  renderImages(buildImageList(p));
  cargarDraftDelSku(skuActivo);
  setActive(btnFamily);

  document.getElementById("modal").classList.add("active");
}

/***********************
 * MODAL: CERRAR
 ***********************/
document.getElementById("closeModal").onclick = () => {
  document.getElementById("modal").classList.remove("active");
};

document.getElementById("modal").onclick = (e) => {
  if (e.target.id === "modal") {
    document.getElementById("modal").classList.remove("active");
  }
};

/***********************
 * AGREGAR AL PEDIDO
 ***********************/
document.getElementById("addBtn").onclick = () => {
  // 1) guardar lo que hay en pantalla en el SKU activo
  guardarDraftDelSkuActual();

  // 2) recorrer todos los drafts y agregar los que tengan cantidades
  let agregoAlgo = false;

  for (const [sku, tallas] of Object.entries(draftTallasPorSku)) {
    const total = Object.values(tallas).reduce((a, b) => a + b, 0);
    if (total > 0) {
      pedido.push({ sku, tallas });
      agregoAlgo = true;
    }
  }

  if (!agregoAlgo) {
    alert("Ingresa al menos una cantidad");
    return;
  }

  // 3) limpiar drafts + inputs
  escribirTallasUI({});

  actualizarCarrito();
  document.getElementById("modal").classList.remove("active");
};

/***********************
 * CARRITO: ACTUALIZAR / ELIMINAR
 ***********************/
function actualizarCarrito() {
  document.getElementById("cartCount").innerText = pedido.length;

  const container = document.getElementById("cartItems");
  container.innerHTML = pedido
    .map(
      (item, index) => `
      <div class="cart-item">
        <div class="cart-item-top">
          <div class="cart-item-title">Modelo ${item.sku}</div>
          <button class="cart-trash" onclick="eliminarItem(${index})">🗑</button>
        </div>
        <div>
          ${Object.entries(item.tallas)
            .map(([t, c]) => `<div>Talla ${t}: <strong>${c}</strong></div>`)
            .join("")}
        </div>
      </div>
    `
    )
    .join("");
}

function eliminarItem(index) {
  pedido.splice(index, 1);
  actualizarCarrito();
}

/***********************
 * ABRIR / CERRAR CARRITO
 ***********************/
document.getElementById("cartToggle").onclick = () => {
  document.getElementById("cartSidebar").classList.add("open");
};

document.addEventListener("click", (e) => {
  const sidebar = document.getElementById("cartSidebar");
  const toggle = document.getElementById("cartToggle");

  if (!sidebar.contains(e.target) && !toggle.contains(e.target)) {
    sidebar.classList.remove("open");
  }
});

/***********************
 * COTIZACIÓN: CSV + MAILTO + LIMPIEZA
 ***********************/
function generarCSV() {
  const nombreTienda = document.getElementById("userName").value.trim();
  if (!nombreTienda || !pedido.length) return null;

  const sep = ";";
  let rows = [];

  rows.push(["Tienda", nombreTienda]);
  rows.push([]);
  rows.push(["SKU", "Talla", "Cantidad"]);

  let totalGeneral = 0;

  pedido.forEach(item => {
    let totalPorSku = 0;

    Object.entries(item.tallas).forEach(([t, c]) => {
      rows.push([item.sku, t, c]);
      totalPorSku += c;
      totalGeneral += c;
    });

    // Línea de total por SKU
    rows.push(["", "Total " + item.sku, totalPorSku]);
    rows.push([]);
  });

  // Total general al final
  rows.push([]);
  rows.push(["TOTAL GENERAL", "", totalGeneral]);

  const BOM = "\uFEFF";

  const csvBody = rows.map(r =>
    r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(sep)
  ).join("\n");

  return BOM + csvBody;
}

function descargarArchivo(nombre, contenido, mime) {
  const blob = new Blob([contenido], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function enviarCotizacionMailto() {
  const nombreTienda = document.getElementById("userName").value.trim();
  if (!nombreTienda) {
    alert("Ingresa el nombre de tu tienda");
    return false;
  }
  if (!pedido.length) {
    alert("Tu pedido está vacío");
    return false;
  }

  const fecha = new Date().toLocaleString();

  let lineas = [];
  lineas.push(`COTIZACIÓN MOHICANO`);
  lineas.push(`Tienda: ${nombreTienda}`);
  lineas.push(`Fecha: ${fecha}`);
  lineas.push(`-------------------------`);

  pedido.forEach((item, idx) => {
    lineas.push(`${idx + 1}) SKU: ${item.sku}`);
    Object.entries(item.tallas).forEach(([t, c]) => {
      lineas.push(`   - Talla ${t}: ${c}`);
    });
    lineas.push(``);
  });

  const subject = encodeURIComponent(`Cotización Mohicano - ${nombreTienda}`);
  const body = encodeURIComponent(lineas.join("\n"));

  window.location.href = `mailto:${EMAIL_DESTINO}?subject=${subject}&body=${body}`;
  return true;
}

function limpiarCarrito() {
  pedido = [];
  actualizarCarrito();
  document.getElementById("userName").value = "";
  document.getElementById("cartSidebar").classList.remove("open");
}

document.getElementById("sendRequest").onclick = () => {
  const nombreTienda = document.getElementById("userName").value.trim();
  if (!nombreTienda) return alert("Ingresa el nombre de tu tienda");
  if (!pedido.length) return alert("Tu pedido está vacío");

  // 1) CSV
  const csv = generarCSV();
  if (csv) {
    const safe = nombreTienda.replace(/\s+/g, "_");
    descargarArchivo(`cotizacion_${safe}_${Date.now()}.csv`, csv, "text/csv;charset=utf-8;");
  }

  // 2) Mailto
  const ok = enviarCotizacionMailto();
  if (ok) limpiarCarrito();
};
  document.getElementById("closeCart").onclick = () => {
  document.getElementById("cartSidebar").classList.remove("open");
  document.querySelector(".cart-overlay")?.classList.remove("active");
};