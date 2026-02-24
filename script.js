/***********************
 * ESTADO GLOBAL
 ***********************/
let productos = [];
let pedido = [];
let skuActivo = "";
let draftTallasPorSku = {}; // { "4204": {38:2,40:1}, "4204-02": {...} }

const ASSET_VERSION = Date.now();

function withCacheBust(path) {
  if (!path) return path;
  return path.includes("?") ? `${path}&v=${ASSET_VERSION}` : `${path}?v=${ASSET_VERSION}`;
}

const EMAIL_DESTINO = "man.cid@mohicanojeans.cl"; // <-- cambia si quieres
const SUPABASE_URL = "https://kdtydxihrflhziclgiof.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_37ce4uK_RG8o9pP-Jdf2Xw_3eWgqJQy";

function supabaseConfigurado() {
  return (
    typeof SUPABASE_URL === "string" &&
    SUPABASE_URL.startsWith("https://") &&
    typeof SUPABASE_ANON_KEY === "string" &&
    SUPABASE_ANON_KEY.trim().length > 20
  );
}

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
  // quitar duplicados y filtrar imágenes de catálogo
  return [...new Set(imgs)].filter(img => !img.toLowerCase().includes("catalogo"));
}

function renderImages(imageList) {
  const viewer = document.getElementById("viewerImg");
  const thumbContainer = document.getElementById("thumbContainer");

  thumbContainer.innerHTML = "";

  if (!imageList || !imageList.length) {
    viewer.src = "";
    return;
  }

  viewer.src = withCacheBust(imageList[0]);

  imageList.forEach((imgSrc, index) => {
    const thumb = document.createElement("img");
    thumb.src = withCacheBust(imgSrc);
    if (index === 0) thumb.classList.add("active-thumb");

    thumb.onclick = () => {
      viewer.src = withCacheBust(imgSrc);
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
        <img src="${withCacheBust(p.main_image)}" alt="Modelo ${p.family}">
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
  
  // Mostrar descripción y características
  const descriptionEl = document.getElementById("description");
  const charList = document.getElementById("characteristics");
  const hasCharacteristics = Array.isArray(p.characteristics) && p.characteristics.length;

  descriptionEl.innerText = hasCharacteristics ? "" : (p.description || "");
  descriptionEl.style.display = hasCharacteristics || !p.description ? "none" : "block";

  charList.innerHTML = "";
  charList.style.display = hasCharacteristics ? "block" : "none";
  if (hasCharacteristics) {
    const ul = document.createElement("ul");
    p.characteristics.forEach((char) => {
      const li = document.createElement("li");
      li.innerText = char;
      ul.appendChild(li);
    });
    charList.appendChild(ul);
  }

  const variantContainer = document.getElementById("variantContainer");
  variantContainer.innerHTML = "";

  // helper: activar botón
  function setActive(btn) {
    variantContainer.querySelectorAll(".variant-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  }


  const familyImages = buildImageList(p);

  // 1) Botón Familia
  const btnFamily = document.createElement("button");
  btnFamily.className = "variant-btn";
  btnFamily.innerText = "Familia " + p.family;
  const botonesPorSku = {};

  btnFamily.onclick = () => {
    guardarDraftDelSkuActual();
    skuActivo = p.family;
    renderImages(buildImageList(p));
    cargarDraftDelSku(skuActivo);
    setActive(btnFamily);
  };

  if (familyImages.length) {
    variantContainer.appendChild(btnFamily);
  }

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

      botonesPorSku[v.sku] = btn;
      variantContainer.appendChild(btn);
    });
  }

  // Estado inicial: si la familia no tiene imágenes visibles, abrir primera variante con imágenes
  const firstVariantWithImages = Array.isArray(p.variants)
    ? p.variants.find((v) => buildImageList(v).length)
    : null;

  const initialSku = familyImages.length ? p.family : (firstVariantWithImages?.sku || p.family);
  const initialImages = familyImages.length
    ? familyImages
    : (firstVariantWithImages ? buildImageList(firstVariantWithImages) : []);
  const initialBtn = initialSku === p.family ? btnFamily : botonesPorSku[initialSku];

  skuActivo = initialSku;
  renderImages(initialImages);
  cargarDraftDelSku(skuActivo);
  setActive(initialBtn || btnFamily);

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

function construirPayloadCotizacion(nombreTienda) {
  const createdAtIso = new Date().toISOString();
  let totalItems = 0;
  const lineas = [];

  pedido.forEach((item) => {
    Object.entries(item.tallas).forEach(([talla, cantidad]) => {
      const qty = Number(cantidad) || 0;
      if (qty <= 0) return;
      totalItems += qty;
      lineas.push({ sku: item.sku, talla, cantidad: qty });
    });
  });

  return {
    quote: {
      store_name: nombreTienda,
      total_items: totalItems,
      created_at_client: createdAtIso,
      source: "web",
    },
    items: lineas,
  };
}

async function guardarCotizacionSupabase(nombreTienda) {
  if (!supabaseConfigurado()) {
    throw new Error("Configura SUPABASE_URL y SUPABASE_ANON_KEY en script.js");
  }

  const payload = construirPayloadCotizacion(nombreTienda);
  if (!payload.items.length) throw new Error("No hay items para guardar");

  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };

  const quoteRes = await fetch(`${SUPABASE_URL}/rest/v1/quotes`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify([payload.quote]),
  });

  if (!quoteRes.ok) {
    const errText = await quoteRes.text();
    throw new Error(`Error guardando cotizacion: ${errText || quoteRes.status}`);
  }

  const rows = await quoteRes.json();
  const quoteRow = rows?.[0];
  if (!quoteRow?.id) throw new Error("Supabase no devolvio el ID de la cotizacion");

  const detailRows = payload.items.map((it) => ({
    quote_id: quoteRow.id,
    sku: it.sku,
    size: String(it.talla),
    quantity: Number(it.cantidad),
  }));

  const itemsRes = await fetch(`${SUPABASE_URL}/rest/v1/quote_items`, {
    method: "POST",
    headers,
    body: JSON.stringify(detailRows),
  });

  if (!itemsRes.ok) {
    const errText = await itemsRes.text();
    throw new Error(`Error guardando detalle: ${errText || itemsRes.status}`);
  }

  return quoteRow.id;
}

function limpiarCarrito() {
  pedido = [];
  actualizarCarrito();
  document.getElementById("userName").value = "";
  document.getElementById("cartSidebar").classList.remove("open");
}

document.getElementById("sendRequest").onclick = async () => {
  const nombreTienda = document.getElementById("userName").value.trim();
  if (!nombreTienda) return alert("Ingresa el nombre de tu tienda");
  if (!pedido.length) return alert("Tu pedido esta vacio");

  const btn = document.getElementById("sendRequest");
  const textoOriginal = btn.innerText;
  btn.disabled = true;
  btn.innerText = "Guardando...";

  try {
    const quoteId = await guardarCotizacionSupabase(nombreTienda);

    const csv = generarCSV();
    if (csv) {
      const safe = nombreTienda.replace(/\s+/g, "_");
      descargarArchivo(`cotizacion_${safe}_${Date.now()}.csv`, csv, "text/csv;charset=utf-8;");
    }

    alert(`Cotizacion guardada correctamente (ID: ${quoteId})`);
    limpiarCarrito();
  } catch (error) {
    console.error(error);
    alert(`No se pudo guardar la cotizacion. ${error.message || ""}`.trim());
  } finally {
    btn.disabled = false;
    btn.innerText = textoOriginal;
  }
};
  document.getElementById("closeCart").onclick = () => {
  document.getElementById("cartSidebar").classList.remove("open");
  document.querySelector(".cart-overlay")?.classList.remove("active");
};
