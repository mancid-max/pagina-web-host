/***********************
 * ESTADO GLOBAL
 ***********************/
let productos = [];
let pedido = [];
let skuActivo = "";
let draftTallasPorSku = {}; // legacy (borradores desactivados)
const TALLAS_DISPONIBLES = ["36", "38", "40", "42", "44", "46"];
let quotesAccessToken = sessionStorage.getItem("quotes_access_token") || "";
let quotesUserEmail = sessionStorage.getItem("quotes_user_email") || "";
let quotesAdminCache = { quotes: [], itemsByQuote: new Map() };
let clienteSeleccionado = null; // { rut, rut_normalized, razon_social }
let clientLookupDebounce = null;
let imagenesModalActual = [];
let imagenModalIndex = 0;
let quotePanelReady = false;

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

function normalizarRut(valor) {
  return String(valor || "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\s+/g, "")
    .replace(/[^0-9K-]/g, "");
}

function formatearRutVisual(rut) {
  const n = normalizarRut(rut);
  if (!n) return "";
  const [bodyRaw, dvRaw] = n.split("-");
  if (!bodyRaw || !dvRaw) return n;
  const body = bodyRaw.replace(/^0+/, "") || "0";
  const invert = body.split("").reverse();
  const parts = [];
  for (let i = 0; i < invert.length; i += 3) {
    parts.push(invert.slice(i, i + 3).reverse().join(""));
  }
  return `${parts.reverse().join(".")}-${dvRaw}`;
}

/***********************
 * CARGAR PRODUCTOS
 ***********************/
fetch("data.json?v=" + Date.now())
  .then((res) => res.json())
  .then((data) => {
    productos = data;
    renderGrid(productos);
    inicializarBuscadorModelos();
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
  const galleryBtn = document.getElementById("openImageGalleryBtn");

  thumbContainer.innerHTML = "";
  imagenesModalActual = Array.isArray(imageList) ? [...imageList] : [];
  imagenModalIndex = 0;
  if (galleryBtn) galleryBtn.hidden = !imagenesModalActual.length;

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
      imagenModalIndex = index;
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
  TALLAS_DISPONIBLES.forEach((t) => {
    const el = document.getElementById("t" + t);
    const v = parseInt(el?.value || "0", 10);
    if (!el) return;
    if (isNaN(v) || v <= 0) {
      if (String(el.value).trim() !== "" && Number(el.value) < 0) el.value = "0";
      return;
    }
    tallas[t] = v;
  });
  return tallas;
}

function escribirTallasUI(tallas = {}) {
  TALLAS_DISPONIBLES.forEach((t) => {
    const el = document.getElementById("t" + t);
    if (!el) return;
    el.value = tallas[t] ? String(tallas[t]) : "";
  });
}

function renderZoomGallery() {
  const zoomMain = document.getElementById("imageZoomMain");
  const zoomThumbs = document.getElementById("imageZoomThumbs");
  if (!zoomMain || !zoomThumbs) return;

  zoomThumbs.innerHTML = "";

  if (!imagenesModalActual.length) {
    zoomMain.src = "";
    return;
  }

  if (imagenModalIndex < 0 || imagenModalIndex >= imagenesModalActual.length) {
    imagenModalIndex = 0;
  }

  zoomMain.src = withCacheBust(imagenesModalActual[imagenModalIndex]);

  imagenesModalActual.forEach((imgSrc, index) => {
    const thumb = document.createElement("img");
    thumb.src = withCacheBust(imgSrc);
    thumb.alt = `Vista ${index + 1}`;
    if (index === imagenModalIndex) thumb.classList.add("active-thumb");
    thumb.onclick = () => {
      imagenModalIndex = index;
      renderZoomGallery();
    };
    zoomThumbs.appendChild(thumb);
  });
}

function abrirVisorImagenes() {
  const zoomModal = document.getElementById("imageZoomModal");
  if (!zoomModal || !imagenesModalActual.length) return;
  renderZoomGallery();
  zoomModal.hidden = false;
  document.body.classList.add("image-zoom-open");
}

function cerrarVisorImagenes() {
  const zoomModal = document.getElementById("imageZoomModal");
  if (!zoomModal) return;
  zoomModal.hidden = true;
  document.body.classList.remove("image-zoom-open");
}

function inicializarPanelCotizacionModal() {
  if (quotePanelReady) return;
  const modalContent = document.querySelector("#modal .modal-content");
  const modalRight = document.querySelector("#modal .modal-right");
  const variantContainer = document.getElementById("variantContainer");
  const sizesPanel = document.querySelector("#modal .sizes-panel");
  const addBtn = document.getElementById("addBtn");
  if (!modalContent || !modalRight || !variantContainer || !sizesPanel || !addBtn) return;

  const trigger = document.createElement("button");
  trigger.id = "openQuotePanelBtn";
  trigger.className = "quote-panel-trigger";
  trigger.type = "button";
  trigger.innerText = "Cotizar este modelo";

  const panel = document.createElement("div");
  panel.id = "quotePanel";
  panel.className = "quote-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="quote-panel-backdrop" data-close-quote-panel></div>
    <div class="quote-panel-card">
      <div class="quote-panel-head">
        <div>
          <div class="quote-panel-kicker">Cotizacion</div>
          <div id="quotePanelModelTitle" class="quote-panel-title">Modelo</div>
        </div>
        <button id="closeQuotePanelBtn" type="button" class="quote-panel-close" aria-label="Cerrar panel de cotizacion">×</button>
      </div>
    </div>
  `;

  const panelCard = panel.querySelector(".quote-panel-card");
  if (!panelCard) return;
  panelCard.appendChild(sizesPanel);
  panelCard.appendChild(addBtn);

  trigger.addEventListener("click", abrirPanelCotizacionModal);
  panel.addEventListener("click", (e) => {
    if (e.target?.dataset?.closeQuotePanel !== undefined) cerrarPanelCotizacionModal();
  });
  panel.querySelector("#closeQuotePanelBtn")?.addEventListener("click", cerrarPanelCotizacionModal);

  modalRight.insertBefore(trigger, variantContainer.nextSibling);
  modalContent.appendChild(panel);
  quotePanelReady = true;
}

function abrirPanelCotizacionModal() {
  const panel = document.getElementById("quotePanel");
  if (!panel) return;
  panel.hidden = false;
  panel.classList.add("open");
}

function cerrarPanelCotizacionModal() {
  const panel = document.getElementById("quotePanel");
  if (!panel) return;
  panel.classList.remove("open");
  panel.hidden = true;
}

function guardarDraftDelSkuActual() {
  // Borradores desactivados: no persistir cantidades al cambiar de modelo/variante
  return;
}

function cargarDraftDelSku(sku) {
  // Siempre iniciar limpio para evitar autocompletar cantidades previas
  escribirTallasUI({});
}

function resetDraftsModal() {
  draftTallasPorSku = {};
  skuActivo = "";
  escribirTallasUI({});
}

function configurarInputsTallas() {
  TALLAS_DISPONIBLES.forEach((t) => {
    const el = document.getElementById("t" + t);
    if (!el) return;
    el.min = "0";
    el.step = "1";
    el.addEventListener("input", () => {
      if (el.value === "") return;
      let n = parseInt(el.value, 10);
      if (isNaN(n)) {
        el.value = "";
        return;
      }
      if (n < 0) n = 0;
      el.value = String(n);
    });
  });
}

function inicializarBuscadorModelos() {
  const input = document.getElementById("modelSearchInput");
  const panel = document.getElementById("modelSuggestionsPanel");
  const btnBuscar = document.getElementById("modelSearchBtn");
  const btnLimpiar = document.getElementById("modelSearchClear");
  if (!input || !panel || !btnBuscar || !btnLimpiar) return;

  const modelos = [...new Set(productos.map((p) => String(p.family)).filter(Boolean))].sort();
  let sugerenciasActuales = [];
  let activeIndex = -1;

  const hideSuggestions = () => {
    panel.hidden = true;
    panel.innerHTML = "";
    sugerenciasActuales = [];
    activeIndex = -1;
  };

  const showSuggestions = (term) => {
    const query = (term || "").trim();
    if (!query) {
      hideSuggestions();
      return;
    }

    sugerenciasActuales = modelos.filter((m) => m.includes(query)).slice(0, 8);
    activeIndex = -1;

    if (!sugerenciasActuales.length) {
      panel.innerHTML = `<div class="model-suggestion-empty">No hay coincidencias</div>`;
      panel.hidden = false;
      return;
    }

    panel.innerHTML = sugerenciasActuales
      .map((m, idx) => `<button type="button" class="model-suggestion-item" data-model="${m}" data-index="${idx}">Modelo ${m}</button>`)
      .join("");
    panel.hidden = false;
  };

  const paintActive = () => {
    panel.querySelectorAll(".model-suggestion-item").forEach((el, idx) => {
      el.classList.toggle("active", idx === activeIndex);
    });
  };

  const filtrarGrid = (term) => {
    if (!term) {
      renderGrid(productos);
      return;
    }
    renderGrid(productos.filter((p) => String(p.family).includes(term)));
  };

  const buscarModelo = () => {
    const term = input.value.trim();
    if (!term) {
      renderGrid(productos);
      hideSuggestions();
      return;
    }

    const exacto = productos.find((p) => String(p.family) === term);
    if (exacto) {
      renderGrid(productos);
      hideSuggestions();
      setTimeout(() => verProducto(exacto.family), 0);
      return;
    }

    filtrarGrid(term);
    hideSuggestions();
  };

  input.addEventListener("input", () => {
    const term = input.value.trim();
    filtrarGrid(term);
    showSuggestions(term);
  });

  input.addEventListener("keydown", (e) => {
    if (!panel.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      if (!sugerenciasActuales.length) return;
      e.preventDefault();
      if (e.key === "ArrowDown") {
        activeIndex = (activeIndex + 1) % sugerenciasActuales.length;
      } else {
        activeIndex = activeIndex <= 0 ? sugerenciasActuales.length - 1 : activeIndex - 1;
      }
      paintActive();
      return;
    }

    if (e.key === "Enter" && !panel.hidden && activeIndex >= 0 && sugerenciasActuales[activeIndex]) {
      e.preventDefault();
      input.value = sugerenciasActuales[activeIndex];
      buscarModelo();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      buscarModelo();
    }

    if (e.key === "Escape") hideSuggestions();
  });

  btnBuscar.addEventListener("click", buscarModelo);
  btnLimpiar.addEventListener("click", () => {
    input.value = "";
    renderGrid(productos);
    hideSuggestions();
    input.focus();
  });

  panel.addEventListener("click", (e) => {
    const btn = e.target.closest(".model-suggestion-item");
    if (!btn) return;
    input.value = btn.dataset.model || "";
    buscarModelo();
  });

  document.addEventListener("click", (e) => {
    const box = document.querySelector(".model-search-box");
    if (!box?.contains(e.target)) hideSuggestions();
  });
}

/***********************
 * GRID
 ***********************/
function renderGrid(lista) {
  const container = document.getElementById("grid");
  container.innerHTML = lista
    .map(
      (p, index) => `
      <div class="card" data-family="${p.family}" onclick="verProducto('${p.family}')">
        <div class="card-title">Modelo ${p.family}</div>
        <img src="${withCacheBust(p.main_image)}" alt="Modelo ${p.family}" loading="${index < 4 ? "eager" : "lazy"}" decoding="async">
      </div>
    `
    )
    .join("");
}

/***********************
 * MODAL: ABRIR
 ***********************/
function verProducto(familyId) {
  inicializarPanelCotizacionModal();
  const p = productos.find((item) => item.family === familyId);
  if (!p) return;

  // Reinicia drafts para evitar re-agregar items viejos al volver a abrir el modal
  resetDraftsModal();
  document.getElementById("modalTitle").innerText = "Modelo " + p.family;
  const quotePanelModelTitle = document.getElementById("quotePanelModelTitle");
  if (quotePanelModelTitle) quotePanelModelTitle.innerText = "Modelo " + p.family;
  cerrarPanelCotizacionModal();
  
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
  btnFamily.innerText = "Modelo " + p.family;
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

  const modalRight = document.querySelector("#modal .modal-right");
  if (modalRight) modalRight.scrollTop = 0;

  document.getElementById("modal").classList.add("active");
}

/***********************
 * MODAL: CERRAR
 ***********************/
document.getElementById("closeModal").onclick = () => {
  document.getElementById("modal").classList.remove("active");
  cerrarVisorImagenes();
  cerrarPanelCotizacionModal();
};

document.getElementById("modal").onclick = (e) => {
  if (e.target.id === "modal") {
    document.getElementById("modal").classList.remove("active");
    cerrarVisorImagenes();
    cerrarPanelCotizacionModal();
  }
};

document.getElementById("openImageGalleryBtn")?.addEventListener("click", abrirVisorImagenes);
document.getElementById("closeImageZoomBtn")?.addEventListener("click", cerrarVisorImagenes);
document.getElementById("imageZoomModal")?.addEventListener("click", (e) => {
  if (e.target.dataset.closeImageZoom !== undefined) cerrarVisorImagenes();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") cerrarVisorImagenes();
  if (e.key === "Escape") cerrarPanelCotizacionModal();
});

/***********************
 * AGREGAR AL PEDIDO
 ***********************/
document.getElementById("addBtn").onclick = () => {
  // Tomar solo lo visible en pantalla para el SKU activo (sin borradores)
  const tallas = leerTallasUI();
  const total = Object.values(tallas).reduce((a, b) => a + b, 0);
  let agregoAlgo = false;

  if (skuActivo && total > 0) {
    const existente = pedido.find((item) => item.sku === skuActivo);
    if (existente) {
      Object.entries(tallas).forEach(([talla, cantidad]) => {
        const qty = Number(cantidad) || 0;
        if (qty <= 0) return;
        existente.tallas[talla] = (Number(existente.tallas[talla]) || 0) + qty;
      });
    } else {
      pedido.push({ sku: skuActivo, tallas: { ...tallas } });
    }
    agregoAlgo = true;
  }

  if (!agregoAlgo) {
    mostrarToastError("Ingresa una cantidad", "Debes ingresar al menos una cantidad para agregar a la cotizacion.");
    return;
  }

  // 3) limpiar inputs
  resetDraftsModal();

  actualizarCarrito();
  mostrarToastExito("Cotización agregada", "Puedes verla en Tu cotización.");
  cerrarPanelCotizacionModal();
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
          <button class="cart-trash" type="button" aria-label="Eliminar modelo ${item.sku}" onclick="eliminarItem(${index})">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h2v9H7V9Zm4 0h2v9h-2V9Zm4 0h2v9h-2V9ZM6 7h12l-1 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7Z"/>
            </svg>
          </button>
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
  const nombreTienda = clienteSeleccionado?.razon_social || "";
  const rutCliente = clienteSeleccionado?.rut || clienteSeleccionado?.rut_normalized || "";
  if (!nombreTienda || !pedido.length) return null;

  const sep = ";";
  let rows = [];

  rows.push(["RUT", rutCliente]);
  rows.push(["Cliente", nombreTienda]);
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

function pad2(n) {
  return String(n).padStart(2, "0");
}

function generarCodigoCotizacionVisual(q) {
  if (!q) return "COT-";
  const raw = String(q.id || "").replace(/-/g, "");
  let acc = 0;
  for (let i = 0; i < raw.length; i++) {
    acc = (acc * 31 + raw.charCodeAt(i)) % 100000;
  }
  return `COT-${String(acc).padStart(5, "0")}`;
}

function generarCSVQuoteAdmin(quote, items = []) {
  const sep = ";";
  const BOM = "\uFEFF";
  const fecha = quote?.created_at ? new Date(quote.created_at).toLocaleString() : "";
  const codigo = generarCodigoCotizacionVisual(quote);
  const estado = quote?.is_ready ? "Cotizacion lista" : "En proceso";
  const rows = [];

  rows.push(["RESUMEN COTIZACION"]);
  rows.push(["Codigo", codigo]);
  rows.push(["Tienda", quote?.store_name || ""]);
  rows.push(["Estado", estado]);
  rows.push(["Fecha", fecha]);
  rows.push(["Total items", quote?.total_items || 0]);
  rows.push(["ID interno (UUID)", quote?.id || ""]);
  rows.push([]);
  rows.push(["DETALLE SOLICITADO POR CLIENTE"]);
  rows.push(["Modelo", "Talla", "Cantidad"]);

  let total = 0;
  const ordered = [...items].sort((a, b) => {
    if (String(a.sku) !== String(b.sku)) return String(a.sku).localeCompare(String(b.sku));
    return String(a.size).localeCompare(String(b.size), undefined, { numeric: true });
  });

  ordered.forEach((it) => {
    rows.push([it.sku, it.size, it.quantity]);
    total += Number(it.quantity) || 0;
  });

  rows.push([]);
  rows.push(["TOTAL GENERAL", "", total]);

  const csvBody = rows
    .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(sep))
    .join("\n");
  return BOM + csvBody;
}

function escapeHtmlExcel(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function generarExcelHtmlQuoteAdmin(quote, items = []) {
  const fecha = quote?.created_at ? new Date(quote.created_at).toLocaleString() : "-";
  const codigo = generarCodigoCotizacionVisual(quote);
  const estado = quote?.is_ready ? "Cotización lista" : "En proceso";
  const rut = quote?.client_rut || "";

  const ordered = [...items].sort((a, b) => {
    if (String(a.sku) !== String(b.sku)) return String(a.sku).localeCompare(String(b.sku));
    return String(a.size).localeCompare(String(b.size), undefined, { numeric: true });
  });

  let total = 0;
  const rows = ordered.map((it) => {
    total += Number(it.quantity) || 0;
    return `
      <tr>
        <td>${escapeHtmlExcel(it.sku)}</td>
        <td>${escapeHtmlExcel(it.size)}</td>
        <td class="num">${escapeHtmlExcel(it.quantity)}</td>
      </tr>
    `;
  }).join("");

  return `\uFEFF<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Type" content="application/vnd.ms-excel; charset=UTF-8" />
<style>
  body{font-family:Calibri,Segoe UI,Arial,sans-serif;background:#fff;color:#111827}
  table{border-collapse:collapse}
  .sheet{min-width:760px}
  .sheet td,.sheet th{border:1px solid #d1d5db;padding:6px 8px;font-size:11pt}
  .title{background:#111827;color:#fff;font-weight:700;font-size:13pt}
  .section{background:#e5e7eb;color:#111827;font-weight:700}
  .label{background:#f3f4f6;font-weight:700;width:180px}
  .value{background:#fff}
  .header th{background:#d71920;color:#fff;font-weight:700;text-align:left}
  .num{text-align:right}
  .pill{background:#ecfdf5;color:#065f46;font-weight:700}
  .pill.warn{background:#fff7ed;color:#9a3412}
  .total-row td{background:#111827;color:#fff;font-weight:700}
  .spacer td{border:none;height:8px;background:#fff}
</style>
</head>
<body>
  <table class="sheet">
    <tr><td class="title" colspan="3">RESUMEN COTIZACION</td></tr>
    <tr><td class="label">Codigo</td><td class="value" colspan="2">${escapeHtmlExcel(codigo)}</td></tr>
    <tr><td class="label">Tienda</td><td class="value" colspan="2">${escapeHtmlExcel(quote?.store_name || "")}</td></tr>
    <tr><td class="label">RUT</td><td class="value" colspan="2">${escapeHtmlExcel(rut)}</td></tr>
    <tr><td class="label">Estado</td><td class="${quote?.is_ready ? "pill" : "pill warn"}" colspan="2">${escapeHtmlExcel(estado)}</td></tr>
    <tr><td class="label">Fecha</td><td class="value" colspan="2">${escapeHtmlExcel(fecha)}</td></tr>
    <tr><td class="label">Total items</td><td class="value num" colspan="2">${escapeHtmlExcel(quote?.total_items || 0)}</td></tr>
    <tr><td class="label">ID interno (UUID)</td><td class="value" colspan="2">${escapeHtmlExcel(quote?.id || "")}</td></tr>
    <tr class="spacer"><td colspan="3"></td></tr>
    <tr><td class="section" colspan="3">DETALLE SOLICITADO POR CLIENTE</td></tr>
    <tr class="header"><th>Modelo</th><th>Talla</th><th>Cantidad</th></tr>
    ${rows || '<tr><td colspan="3">Sin detalle</td></tr>'}
    <tr class="spacer"><td colspan="3"></td></tr>
    <tr class="total-row"><td colspan="2">TOTAL GENERAL</td><td class="num">${escapeHtmlExcel(total)}</td></tr>
  </table>
</body>
</html>`;
}

function descargarCotizacionAdmin(quoteId) {
  const quote = quotesAdminCache.quotes.find((q) => q.id === quoteId);
  const items = quotesAdminCache.itemsByQuote.get(quoteId) || [];
  if (!quote) {
    actualizarEstadoQuotesUI("No se encontro la cotizacion para descargar");
    return;
  }
  const codigo = generarCodigoCotizacionVisual(quote).replace(/[^\w-]/g, "_");
  const tienda = String(quote.store_name || "tienda").replace(/\s+/g, "_");
  const excelHtml = generarExcelHtmlQuoteAdmin(quote, items);
  descargarArchivo(`${codigo}_${tienda}.xls`, excelHtml, "application/vnd.ms-excel;charset=utf-8;");
}

function mostrarToastExito(titulo, mensaje) {
  const toast = document.getElementById("successToast");
  if (!toast) return;
  const titleEl = toast.querySelector("strong");
  const msgEl = toast.querySelector("span");
  if (titleEl) titleEl.innerText = titulo || "Cotizacion enviada con exito";
  if (msgEl) msgEl.innerText = typeof mensaje === "string" ? mensaje : "";
  toast.hidden = false;
  toast.classList.remove("show");
  // Reinicia animacion
  void toast.offsetWidth;
  toast.classList.add("show");
  window.clearTimeout(mostrarToastExito._timer);
  mostrarToastExito._timer = window.setTimeout(() => {
    toast.classList.remove("show");
    toast.hidden = true;
  }, 3300);
}

function mostrarToastError(titulo, mensaje) {
  const toast = document.getElementById("errorToast");
  const titleEl = document.getElementById("errorToastTitle");
  const msgEl = document.getElementById("errorToastMsg");
  if (!toast) return;
  if (titleEl) titleEl.innerText = titulo || "Revisa los datos";
  if (msgEl) msgEl.innerText = mensaje || "Hay un problema con la informacion ingresada.";
  toast.hidden = false;
  toast.classList.remove("show");
  void toast.offsetWidth;
  toast.classList.add("show");
  window.clearTimeout(mostrarToastError._timer);
  mostrarToastError._timer = window.setTimeout(() => {
    toast.classList.remove("show");
    toast.hidden = true;
  }, 3300);
}

function asegurarConfirmModal() {
  let modal = document.getElementById("confirmActionModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "confirmActionModal";
  modal.className = "confirm-action-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="confirm-action-backdrop" data-confirm-cancel></div>
    <div class="confirm-action-card" role="dialog" aria-modal="true" aria-labelledby="confirmActionTitle">
      <div class="confirm-action-icon">!</div>
      <div class="confirm-action-copy">
        <div id="confirmActionTitle" class="confirm-action-title">Confirmar accion</div>
        <div id="confirmActionMsg" class="confirm-action-msg">¿Estas seguro?</div>
      </div>
      <div class="confirm-action-buttons">
        <button type="button" id="confirmActionCancel" class="ghost-btn">Cancelar</button>
        <button type="button" id="confirmActionOk" class="confirm-danger-btn">Eliminar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function mostrarConfirmacionAccion({ titulo = "Confirmar", mensaje = "¿Estas seguro?", confirmarTexto = "Aceptar" } = {}) {
  const modal = asegurarConfirmModal();
  const titleEl = modal.querySelector("#confirmActionTitle");
  const msgEl = modal.querySelector("#confirmActionMsg");
  const okBtn = modal.querySelector("#confirmActionOk");
  const cancelBtn = modal.querySelector("#confirmActionCancel");
  const backdrop = modal.querySelector(".confirm-action-backdrop");

  if (titleEl) titleEl.innerText = titulo;
  if (msgEl) msgEl.innerText = mensaje;
  if (okBtn) okBtn.innerText = confirmarTexto;

  modal.hidden = false;
  modal.classList.remove("show");
  void modal.offsetWidth;
  modal.classList.add("show");

  return new Promise((resolve) => {
    const cleanup = (result) => {
      modal.classList.remove("show");
      modal.hidden = true;
      okBtn?.removeEventListener("click", onOk);
      cancelBtn?.removeEventListener("click", onCancel);
      backdrop?.removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKeydown);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onKeydown = (e) => {
      if (e.key === "Escape") cleanup(false);
      if (e.key === "Enter") cleanup(true);
    };
    okBtn?.addEventListener("click", onOk);
    cancelBtn?.addEventListener("click", onCancel);
    backdrop?.addEventListener("click", onCancel);
    document.addEventListener("keydown", onKeydown);
  });
}

function setClientLookupUI({ tipo = "", texto = "", badge = "" } = {}) {
  const msgEl = document.getElementById("clientLookupMsg");
  const badgeEl = document.getElementById("clientLookupBadge");
  if (msgEl) {
    msgEl.className = "client-lookup-msg" + (tipo ? ` ${tipo}` : "");
    msgEl.innerText = texto || "";
    if (tipo === "error") {
      msgEl.classList.remove("shake");
      void msgEl.offsetWidth;
      msgEl.classList.add("shake");
    }
  }
  if (badgeEl) {
    if (badge) {
      badgeEl.hidden = false;
      badgeEl.innerText = badge;
    } else {
      badgeEl.hidden = true;
      badgeEl.innerText = "";
    }
  }
}

async function buscarClientePorRutSupabase(rutInput) {
  const rutNormalizado = normalizarRut(rutInput);
  if (!rutNormalizado) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/lookup_client_by_rut`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_rut: rutNormalizado }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`No se pudo validar RUT: ${txt || res.status}`);
  }
  const data = await res.json();
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    rut: row.rut || rutInput,
    rut_normalized: row.rut_normalized || rutNormalizado,
    razon_social: row.razon_social || "",
  };
}

async function validarRutClienteEnUI({ silencioso = false } = {}) {
  const input = document.getElementById("clientRut");
  if (!input) return null;
  const raw = input.value.trim();
  const rutNormalizado = normalizarRut(raw);

  clienteSeleccionado = null;

  if (!rutNormalizado) {
    setClientLookupUI();
    return null;
  }

  if (!/^[0-9]+-[0-9K]$/i.test(rutNormalizado)) {
    if (!silencioso) setClientLookupUI({ tipo: "error", texto: "Formato de RUT inválido" });
    return null;
  }

  setClientLookupUI({ tipo: "loading", texto: "Buscando cliente..." });
  try {
    const cliente = await buscarClientePorRutSupabase(rutNormalizado);
    if (!cliente) {
      setClientLookupUI({ tipo: "error", texto: "Cliente no existe" });
      return null;
    }
    clienteSeleccionado = cliente;
    input.value = formatearRutVisual(cliente.rut || cliente.rut_normalized);
    setClientLookupUI({
      tipo: "ok",
      texto: "Cliente encontrado",
      badge: cliente.razon_social,
    });
    return cliente;
  } catch (err) {
    setClientLookupUI({ tipo: "error", texto: err.message || "No se pudo validar RUT" });
    return null;
  }
}

function configurarLookupCliente() {
  const input = document.getElementById("clientRut");
  if (!input) return;
  input.addEventListener("input", () => {
    clienteSeleccionado = null;
    setClientLookupUI();
    window.clearTimeout(clientLookupDebounce);
    clientLookupDebounce = window.setTimeout(() => {
      validarRutClienteEnUI({ silencioso: true });
    }, 320);
  });
  input.addEventListener("blur", () => {
    window.clearTimeout(clientLookupDebounce);
    validarRutClienteEnUI();
  });
}

function construirPayloadCotizacion(cliente) {
  const createdAtIso = new Date().toISOString();
  const quoteId = (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function")
    ? globalThis.crypto.randomUUID()
    : `q-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
      id: quoteId,
      store_name: cliente?.razon_social || "",
      client_rut: cliente?.rut || cliente?.rut_normalized || null,
      client_rut_normalized: cliente?.rut_normalized || normalizarRut(cliente?.rut || ""),
      total_items: totalItems,
      created_at_client: createdAtIso,
      source: "web",
    },
    items: lineas,
  };
}

async function guardarCotizacionSupabase(cliente) {
  if (!supabaseConfigurado()) {
    throw new Error("Configura SUPABASE_URL y SUPABASE_ANON_KEY en script.js");
  }

  const payload = construirPayloadCotizacion(cliente);
  if (!payload.items.length) throw new Error("No hay items para guardar");

  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };

  const quoteRes = await fetch(`${SUPABASE_URL}/rest/v1/quotes`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify([payload.quote]),
  });

  if (!quoteRes.ok) {
    const errText = await quoteRes.text();
    throw new Error(`Error guardando cotizacion: ${errText || quoteRes.status}`);
  }

  const quoteId = payload.quote.id;
  if (!quoteId) throw new Error("No se genero ID de cotizacion");

  const detailRows = payload.items.map((it) => ({
    quote_id: quoteId,
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

  return quoteId;
}

async function loginCotizacionesSupabase(email, password) {
  if (!supabaseConfigurado()) {
    throw new Error("Configura SUPABASE_URL y SUPABASE_ANON_KEY en script.js");
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error_description || data?.msg || "Login invalido");
  }

  if (!data?.access_token) throw new Error("No se recibio access_token");
  quotesAccessToken = data.access_token;
  quotesUserEmail = data?.user?.email || email;
  sessionStorage.setItem("quotes_access_token", quotesAccessToken);
  sessionStorage.setItem("quotes_user_email", quotesUserEmail);
}

function logoutCotizaciones() {
  quotesAccessToken = "";
  quotesUserEmail = "";
  sessionStorage.removeItem("quotes_access_token");
  sessionStorage.removeItem("quotes_user_email");
  actualizarEstadoQuotesUI();
  const list = document.getElementById("quotesList");
  if (list) list.innerHTML = "";
}

function actualizarEstadoQuotesUI(msg = "") {
  const loginSection = document.getElementById("quotesLoginSection");
  const panel = document.getElementById("quotesPanel");
  const badge = document.getElementById("quotesUserBadge");
  const msgEl = document.getElementById("quotesLoginMsg");
  const refreshBtn = document.getElementById("refreshQuotesBtn");
  const logoutBtn = document.getElementById("logoutQuotesBtn");
  const quotesModalContent = document.querySelector("#quotesModal .quotes-modal-content");
  const quotesAdminWrap = document.querySelector("#quotesModal .quotes-admin");
  const autenticado = !!quotesAccessToken;

  if (msgEl) msgEl.innerText = msg;
  if (loginSection) loginSection.style.display = autenticado ? "none" : "flex";
  if (panel) panel.style.display = autenticado ? "flex" : "none";
  if (badge) badge.innerText = autenticado ? `Sesion: ${quotesUserEmail}` : "";
  if (refreshBtn) refreshBtn.style.display = autenticado ? "inline-flex" : "none";
  if (logoutBtn) logoutBtn.style.display = autenticado ? "inline-flex" : "none";
  quotesModalContent?.classList.toggle("login-only", !autenticado);
  quotesAdminWrap?.classList.toggle("login-only", !autenticado);
}

function agruparItemsPorQuote(items = []) {
  const map = new Map();
  items.forEach((it) => {
    if (!map.has(it.quote_id)) map.set(it.quote_id, []);
    map.get(it.quote_id).push(it);
  });
  return map;
}

function agruparDetallePorModelo(items = []) {
  const map = new Map();
  items.forEach((it) => {
    const sku = String(it.sku || "");
    if (!sku) return;
    if (!map.has(sku)) map.set(sku, {});
    const tallas = map.get(sku);
    const talla = String(it.size || "");
    tallas[talla] = (Number(tallas[talla]) || 0) + (Number(it.quantity) || 0);
  });
  return [...map.entries()].map(([sku, tallas]) => ({ sku, tallas }));
}

function renderCotizacionesAdmin(quotes = [], items = []) {
  const list = document.getElementById("quotesList");
  if (!list) return;

  if (!quotes.length) {
    list.innerHTML = `<div class="quote-card"><div class="quote-meta">No hay cotizaciones para mostrar.</div></div>`;
    return;
  }

  const itemsMap = agruparItemsPorQuote(items);
  quotesAdminCache = { quotes: [...quotes], itemsByQuote: itemsMap };
  list.innerHTML = quotes.map((q) => {
    const detalles = (itemsMap.get(q.id) || []).sort((a, b) => {
      if (String(a.sku) !== String(b.sku)) return String(a.sku).localeCompare(String(b.sku));
      return String(a.size).localeCompare(String(b.size), undefined, { numeric: true });
    });
    const detalleAgrupado = agruparDetallePorModelo(detalles);
    const fecha = q.created_at ? new Date(q.created_at).toLocaleString() : "-";
    const isReady = !!q.is_ready;
    const codigo = generarCodigoCotizacionVisual(q);
    return `
      <div class="quote-card" data-quote-id="${q.id}">
        <div class="quote-card-head">
          <div>
            <div class="quote-card-title-row">
              <div class="quote-card-title">${q.store_name || "Sin tienda"}</div>
              ${q.client_rut ? `<div class="quote-meta quote-meta-inline">RUT: ${q.client_rut}</div>` : ""}
            </div>
            <div class="quote-code-row">
              <span class="quote-code-pill">${codigo}</span>
              <button type="button" class="ghost-btn quote-export-btn" data-quote-export="${q.id}">Descargar Excel</button>
              <button type="button" class="ghost-btn quote-delete-btn" data-quote-delete="${q.id}">Eliminar cotización</button>
            </div>
          </div>
          <div class="quote-meta">Total items: ${q.total_items || 0}<br>${fecha}</div>
        </div>
        <div class="quote-status">
          <div class="quote-status-text ${isReady ? "ready" : ""}">
            ${isReady ? "Cotización lista" : "En proceso"}
          </div>
          <label class="quote-status-toggle">
            <input type="checkbox" class="quote-ready-checkbox" data-quote-id="${q.id}" ${isReady ? "checked" : ""}>
            Cotización lista
          </label>
        </div>
        <div class="quote-items-grid">
          ${detalleAgrupado.length
            ? detalleAgrupado.map((g) => {
              const tallasTxt = Object.entries(g.tallas)
                .sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }))
                .map(([t, q]) => `T${t}: <strong>${q}</strong>`)
                .join(" · ");
              return `<div class="quote-item-line"><span class="quote-item-model">Modelo ${g.sku}</span><span class="quote-item-sizes">${tallasTxt}</span></div>`;
            }).join("")
            : `<div class="quote-item-line">Sin detalle</div>`
          }
        </div>
      </div>
    `;
  }).join("");
}

async function actualizarEstadoCotizacion(quoteId, isReady) {
  if (!quotesAccessToken) throw new Error("Debes iniciar sesion");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/quotes?id=eq.${quoteId}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${quotesAccessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      is_ready: !!isReady,
      ready_at: isReady ? new Date().toISOString() : null,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`No se pudo actualizar estado: ${txt || res.status}`);
  }
}

async function eliminarCotizacionAdmin(quoteId) {
  if (!quotesAccessToken) throw new Error("Debes iniciar sesion");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/quotes?id=eq.${quoteId}`, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${quotesAccessToken}`,
      Prefer: "return=minimal",
    },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`No se pudo eliminar cotizacion: ${txt || res.status}`);
  }
}

async function cargarCotizacionesAdmin() {
  if (!quotesAccessToken) throw new Error("Debes iniciar sesion");

  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${quotesAccessToken}`,
  };

  const quotesRes = await fetch(
    `${SUPABASE_URL}/rest/v1/quotes?select=id,store_name,client_rut,client_rut_normalized,total_items,created_at,created_at_client,source,is_ready,ready_at&order=created_at.desc&limit=50`,
    { headers }
  );

  if (!quotesRes.ok) {
    if (quotesRes.status === 401 || quotesRes.status === 403) logoutCotizaciones();
    const errText = await quotesRes.text();
    throw new Error(`No se pudieron cargar cotizaciones: ${errText || quotesRes.status}`);
  }

  const quotes = await quotesRes.json();
  if (!quotes.length) {
    renderCotizacionesAdmin([], []);
    return;
  }

  const ids = quotes.map((q) => q.id).filter(Boolean);
  let items = [];
  if (ids.length) {
    const inFilter = `(${ids.join(",")})`;
    const itemsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/quote_items?select=quote_id,sku,size,quantity&quote_id=in.${inFilter}&order=id.desc`,
      { headers }
    );
    if (!itemsRes.ok) {
      const errText = await itemsRes.text();
      throw new Error(`No se pudieron cargar items: ${errText || itemsRes.status}`);
    }
    items = await itemsRes.json();
  }

  renderCotizacionesAdmin(quotes, items);
}

function abrirQuotesModal() {
  document.getElementById("quotesModal")?.classList.add("active");
  actualizarEstadoQuotesUI("");
  if (quotesAccessToken) {
    cargarCotizacionesAdmin().catch((err) => actualizarEstadoQuotesUI(err.message || "Error cargando"));
  }
}

function cerrarQuotesModal() {
  document.getElementById("quotesModal")?.classList.remove("active");
}

function configurarPanelCotizaciones() {
  const btnOpen = document.getElementById("quotesAdminBtn");
  const btnClose = document.getElementById("closeQuotesModal");
  const modal = document.getElementById("quotesModal");
  const btnLogin = document.getElementById("quotesLoginBtn");
  const btnRefresh = document.getElementById("refreshQuotesBtn");
  const btnLogout = document.getElementById("logoutQuotesBtn");
  const emailEl = document.getElementById("quotesEmail");
  const passEl = document.getElementById("quotesPassword");
  const quotesListEl = document.getElementById("quotesList");

  const ejecutarLogin = async () => {
    const email = emailEl?.value.trim();
    const password = passEl?.value || "";
    if (!email || !password) {
      actualizarEstadoQuotesUI("Ingresa correo y contrasena");
      return;
    }

    btnLogin.disabled = true;
    btnLogin.innerText = "Ingresando...";
    actualizarEstadoQuotesUI("Validando acceso...");
    try {
      await loginCotizacionesSupabase(email, password);
      actualizarEstadoQuotesUI("");
      await cargarCotizacionesAdmin();
      if (passEl) passEl.value = "";
    } catch (err) {
      actualizarEstadoQuotesUI(err.message || "No se pudo iniciar sesion");
    } finally {
      btnLogin.disabled = false;
      btnLogin.innerText = "Ingresar";
    }
  };

  actualizarEstadoQuotesUI("");

  btnOpen?.addEventListener("click", abrirQuotesModal);
  btnClose?.addEventListener("click", cerrarQuotesModal);
  modal?.addEventListener("click", (e) => {
    if (e.target?.id === "quotesModal") cerrarQuotesModal();
  });

  btnLogin?.addEventListener("click", ejecutarLogin);

  [emailEl, passEl].forEach((el) => {
    el?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        ejecutarLogin();
      }
    });
  });

  btnRefresh?.addEventListener("click", async () => {
    try {
      await cargarCotizacionesAdmin();
    } catch (err) {
      actualizarEstadoQuotesUI(err.message || "No se pudo actualizar");
    }
  });

  btnLogout?.addEventListener("click", logoutCotizaciones);

  quotesListEl?.addEventListener("change", async (e) => {
    const checkbox = e.target.closest(".quote-ready-checkbox");
    if (!checkbox) return;
    const quoteId = checkbox.dataset.quoteId;
    const checked = !!checkbox.checked;
    checkbox.disabled = true;
    try {
      await actualizarEstadoCotizacion(quoteId, checked);
      await cargarCotizacionesAdmin();
    } catch (err) {
      checkbox.checked = !checked;
      actualizarEstadoQuotesUI(err.message || "No se pudo actualizar estado");
    } finally {
      checkbox.disabled = false;
    }
  });

  quotesListEl?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-quote-export]");
    if (btn) {
      descargarCotizacionAdmin(btn.dataset.quoteExport);
      return;
    }

    const deleteBtn = e.target.closest("[data-quote-delete]");
    if (!deleteBtn) return;

    const quoteId = deleteBtn.dataset.quoteDelete;
    const quote = quotesAdminCache.quotes.find((q) => q.id === quoteId);
    const codigo = generarCodigoCotizacionVisual(quote);

    (async () => {
      const confirmar = await mostrarConfirmacionAccion({
        titulo: "Eliminar cotización",
        mensaje: `Se eliminará ${codigo}${quote?.store_name ? ` (${quote.store_name})` : ""}. Esta acción no se puede deshacer.`,
        confirmarTexto: "Sí, eliminar",
      });
      if (!confirmar) return;

      const textoOriginal = deleteBtn.innerText;
      deleteBtn.disabled = true;
      deleteBtn.innerText = "Eliminando...";
      try {
        await eliminarCotizacionAdmin(quoteId);
        mostrarToastExito("Cotización eliminada", "La cotización se eliminó correctamente.");
        await cargarCotizacionesAdmin();
      } catch (err) {
        mostrarToastError("No se pudo eliminar", err.message || "Error eliminando cotización");
      } finally {
        deleteBtn.disabled = false;
        deleteBtn.innerText = textoOriginal;
      }
    })();
  });
}

function limpiarCarrito() {
  pedido = [];
  actualizarCarrito();
  const rutEl = document.getElementById("clientRut");
  if (rutEl) rutEl.value = "";
  clienteSeleccionado = null;
  setClientLookupUI();
  document.getElementById("cartSidebar").classList.remove("open");
}

document.getElementById("sendRequest").onclick = async () => {
  const cliente = clienteSeleccionado || await validarRutClienteEnUI();
  if (!cliente) return mostrarToastError("RUT no valido", "Ingresa un RUT registrado para enviar la cotizacion.");
  if (!pedido.length) return alert("Tu pedido esta vacio");

  const btn = document.getElementById("sendRequest");
  const textoOriginal = btn.innerText;
  btn.disabled = true;
  btn.innerText = "Guardando...";

  try {
    await guardarCotizacionSupabase(cliente);

    mostrarToastExito("Cotizacion enviada con exito", "");
    limpiarCarrito();
  } catch (error) {
    console.error(error);
    alert(`No se pudo guardar la cotizacion. ${error.message || ""}`.trim());
  } finally {
    btn.disabled = false;
    btn.innerText = textoOriginal;
  }
};
configurarInputsTallas();
configurarLookupCliente();
configurarPanelCotizaciones();

document.getElementById("closeCart").onclick = () => {
  document.getElementById("cartSidebar").classList.remove("open");
  document.querySelector(".cart-overlay")?.classList.remove("active");
};
