import React, { useState, useMemo, useEffect, useCallback } from "react";
import heroImg from "./assets/hero.png";
import {
  Menu, X, ChevronRight, Check, Calendar, Clock, MapPin,
  Phone, Mail, User, Search, ArrowRight, ArrowLeft, BarChart3,
  Users, ClipboardList, History, ShieldCheck, Home as HomeIcon,
  Building2, Store, Warehouse, UtensilsCrossed, FileDown,
  AlertTriangle, CircleCheck, CircleDot, LayoutDashboard, FileText,
  Info, Lock, Package, Truck, LogOut, Plus, Trash2,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { jsPDF } from "jspdf";

/* ============================================================
   CONEXIÓN CON LA API (PHP + MySQL)
   ============================================================ */

/* Dirección de la API. Si tu carpeta se llama distinto, cámbiala aquí
   o crea un archivo .env con:  VITE_API_URL=http://localhost/marronking/api */
const API_URL = (import.meta.env && import.meta.env.VITE_API_URL) || "http://localhost/marronking/api";

class ApiErr extends Error {
  constructor(message, status = 0, campos = {}) { super(message); this.status = status; this.campos = campos; }
}

async function api(ruta, { method = "GET", body } = {}) {
  const opciones = { method, credentials: "include" };
  if (method !== "GET") {
    opciones.headers = { "Content-Type": "application/json", "X-Requested-With": "fetch" };
    if (body !== undefined) opciones.body = JSON.stringify(body);
  }
  let res;
  try { res = await fetch(`${API_URL}${ruta}`, opciones); }
  catch { throw new ApiErr("No se pudo conectar con el servidor. Verifica que Apache y MySQL estén encendidos.", 0); }
  let data = null;
  try { data = await res.json(); } catch { /* respuesta sin JSON */ }
  if (!res.ok) {
    throw new ApiErr(data?.error || `Error del servidor (${res.status}).`, res.status, data?.campos && !Array.isArray(data.campos) ? data.campos : {});
  }
  return data;
}

/* Estados: 1 Pendiente · 2 Confirmado · 3 En proceso · 4 Completado · 5 Cancelado */
const ESTADOS_CERRADOS = [4, 5];
const ESTADOS_REQUIEREN_TECNICO = [2, 3, 4];
const UNIDADES = ["L","kg","piezas","bloques","cajas"];
const ZONAS = ["Monterrey","San Nicolás de los Garza","Guadalupe","Apodaca","General Escobedo","Santa Catarina","San Pedro Garza García","García","Juárez"];

/* ── Validadores reutilizables ── */
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const soloDigitos = (v) => String(v||"").replace(/\D/g,"");
const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i;
const fmtTel = (t) => { const d = soloDigitos(t); return d.length === 10 ? `${d.slice(0,2)} ${d.slice(2,6)} ${d.slice(6)}` : (t || ""); };

const ESTADO_STYLE = {
  "Pendiente":  { bg: "#FFF4E0", fg: "#8A5A00", dot: "#E8A33D" },
  "Confirmado": { bg: "#E3F1FD", fg: "#0D4D8A", dot: "#1976D2" },
  "En proceso": { bg: "#E6F5F3", fg: "#00473D", dot: "#00695C" },
  "Completado": { bg: "#EAF7EA", fg: "#1E5E24", dot: "#3E9142" },
  "Cancelado":  { bg: "#FBEAEA", fg: "#8A2626", dot: "#C1473F" },
};

/* Ícono de cada tipo de inmueble (el nombre viene de la base de datos) */
const INMUEBLE_ICONS = {
  "Casa habitación": HomeIcon, "Departamento": Building2, "Oficina": Store,
  "Bodega / Local comercial": Warehouse, "Restaurante / Cocina": UtensilsCrossed,
};

/* Dibujo de cada plaga según su nombre en la base de datos */
const glyphKey = (nombre = "") => {
  const n = nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return n.startsWith("chinch") ? "chinches" : n;
};

/* ============================================================
   UTILIDADES
   ============================================================ */

const currency = (n) =>
  n.toLocaleString("es-MX", { style:"currency", currency:"MXN", maximumFractionDigits:0 });
const currency2 = (n) =>
  n.toLocaleString("es-MX", { style:"currency", currency:"MXN", minimumFractionDigits:2, maximumFractionDigits:2 });
const mxn = (n) => `${currency(n)} MXN`;

const IVA_RATE = 0.16;
const calcIva  = (subtotal) => Math.round(subtotal * IVA_RATE);          // 16% real, sin redondear a decenas
const money    = (subtotal) => ({ subtotal, iva: calcIva(subtotal), total: subtotal + calcIva(subtotal) });

/* Fecha local de hoy en formato YYYY-MM-DD (evita el desfase de toISOString por zona horaria) */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

/* Cotización en pantalla (vista previa instantánea). Usa los precios y multiplicadores
   del catálogo de la base de datos; el servidor vuelve a calcular el precio al guardar. */
function computeQuote({ propertyId, pestId, sizeId, serviceId }, cat) {
  const prop    = cat.inmuebles.find((p) => p.id === propertyId);
  const pest    = cat.plagas.find((p)    => p.id === pestId);
  const size    = cat.tamanos.find((s)   => s.id === sizeId);
  const service = cat.servicios.find((s) => s.id === serviceId);
  if (!prop || !pest || !size || !service) return null;
  const raw      = service.precio_base * size.multiplicador * prop.multiplicador + pest.recargo;
  const subtotal = Math.round(raw / 10) * 10;
  const promo = (cat.promociones || [])
    .filter((p) => (p.plaga_id == null || p.plaga_id === pest.id) && (p.inmueble_id == null || p.inmueble_id === prop.id))
    .sort((a, b) => b.descuento_porcentaje - a.descuento_porcentaje)[0] || null;
  const descuento = promo ? Math.round(subtotal * promo.descuento_porcentaje / 100) : 0;
  const iva      = Math.round((subtotal - descuento) * (cat.iva ?? IVA_RATE));
  const total    = subtotal - descuento + iva;
  const low      = Math.round((total * 0.92) / 10) * 10;
  const high     = Math.round((total * 1.08) / 10) * 10;
  return { prop, pest, size, service, subtotal, descuento, promo, iva, total, low, high };
}

/* ============================================================
   COMPROBANTE PDF + ENVÍO DE FOLIO POR CORREO
   ============================================================ */

/* ▼▼ CONFIGURA ESTO ▼▼ */
const EMAIL_EMPRESA = "ventas@marronking.mx";   // correo de la empresa (usado en el enlace de respaldo)
/* ▲▲ ─────────────── ▲▲ */

/* Genera y descarga el comprobante en PDF (diseño de ticket con muescas) */
function generarPdfComprobante(d) {
  const doc = new jsPDF({ unit:"mm", format:"a4" });
  const PW = 210, PH = 297, CW = 120, CX = (PW - CW) / 2, CY = 22, PAD = 10, VW = CW - PAD * 2 - 32;
  const teal = [0,105,92], ink = [11,35,32], soft = [75,104,100], line = [215,224,222], blue = [25,118,210], grey = [236,239,241];
  const fmt = (n) => currency(n).replace(/\u00A0/g, " ");
  const generado = new Date().toLocaleString("es-MX", { dateStyle:"medium", timeStyle:"short" });

  const filas = [
    ["Cliente",   d.cliente],
    ["Teléfono",  d.telefono],
    ["Correo",    d.correo],
    ["Servicio",  d.servicio],
    ["Plaga",     d.plaga],
    ["Inmueble",  `${d.inmueble} · ${d.tamano}`],
    ["Dirección", d.direccionCompleta],
    ["Fecha",     `${d.fecha} · ${d.horario}`],
  ];
  if (d.notas) filas.push(["Notas", d.notas.slice(0, 160)]);

  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
  const lineas   = filas.map(([, v]) => doc.splitTextToSize(String(v), VW));
  const altoFila = (n) => n * 4.4 + 2.8;
  const altoFilas = lineas.reduce((a, l) => a + altoFila(l.length), 0);
  const nota = "Estimado no vinculante. El precio final se confirma al agendar la visita.";
  const filasTot = [["Subtotal", fmt(d.subtotal)], ...((d.descuento || 0) > 0 ? [["Descuento", "-" + fmt(d.descuento)]] : []), ["IVA (16%)", fmt(d.iva)]];
  const HEAD = 30, FOLIO = 22, DIV = 12, TOTALES = 14 + filasTot.length * 6.5, NOTA = 14, FOOT = 14;
  const CH = HEAD + FOLIO + altoFilas + DIV + TOTALES + NOTA + FOOT;

  // Fondo y tarjeta
  doc.setFillColor(...grey); doc.rect(0, 0, PW, PH, "F");
  doc.setFillColor(255,255,255); doc.setDrawColor(...line); doc.setLineWidth(0.3);
  doc.rect(CX, CY, CW, CH, "FD");

  // Encabezado
  doc.setFillColor(...teal); doc.rect(CX, CY, CW, HEAD, "F");
  doc.setTextColor(255,255,255);
  doc.setFont("helvetica", "bold");   doc.setFontSize(15);  doc.text("MARRÓN KING", CX + PAD, CY + 13);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.text("Control de plagas", CX + PAD, CY + 19.5);
  doc.setFont("helvetica", "bold");   doc.setFontSize(7.5); doc.text("COMPROBANTE DE SOLICITUD", CX + CW - PAD, CY + 13, { align:"right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.text(`Generado: ${generado}`, CX + CW - PAD, CY + 19.5, { align:"right" });

  // Folio
  let y = CY + HEAD + 10;
  doc.setTextColor(...soft); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
  doc.text("FOLIO DE SERVICIO", CX + PAD, y);
  doc.setTextColor(...ink); doc.setFont("courier", "bold"); doc.setFontSize(19);
  doc.text(d.folio, CX + PAD, y + 9);
  y = CY + HEAD + FOLIO;

  // Datos
  doc.setFontSize(9.5);
  filas.forEach(([k], i) => {
    y += 1.4;
    doc.setFont("helvetica", "normal"); doc.setTextColor(...soft); doc.text(k, CX + PAD, y + 3);
    doc.setFont("helvetica", "bold");   doc.setTextColor(...ink);  doc.text(lineas[i], CX + CW - PAD, y + 3, { align:"right" });
    y += altoFila(lineas[i].length) - 1.4;
  });

  // Divisor perforado con muescas
  y += 4;
  doc.setDrawColor(...line); doc.setLineDashPattern([1.2, 1.2], 0); doc.line(CX + PAD, y, CX + CW - PAD, y); doc.setLineDashPattern([], 0);
  doc.setFillColor(...grey); doc.circle(CX, y, 3.4, "F"); doc.circle(CX + CW, y, 3.4, "F");

  // Totales
  y += 9;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
  filasTot.forEach(([k, v]) => {
    doc.setTextColor(...soft); doc.setFont("helvetica", "normal"); doc.text(k, CX + PAD, y);
    doc.setTextColor(...ink);  doc.setFont("helvetica", "bold");   doc.text(v, CX + CW - PAD, y, { align:"right" });
    y += 6.5;
  });
  doc.setTextColor(...ink); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.text("Total estimado", CX + PAD, y + 1);
  doc.setTextColor(...blue); doc.setFont("courier", "bold"); doc.setFontSize(14); doc.text(fmt(d.total), CX + CW - PAD, y + 1, { align:"right" });

  // Nota y pie
  y += 11;
  doc.setTextColor(...soft); doc.setFont("helvetica", "italic"); doc.setFontSize(7.5);
  doc.text(doc.splitTextToSize(nota, CW - PAD * 2), CX + PAD, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
  doc.text("Marrón King · 81 8000 1234 · hola@marronking.mx", CX + CW / 2, CY + CH - 6, { align:"center" });

  doc.save(`Comprobante-${d.folio}.pdf`);
}

/* Texto del correo con el folio */
function textoFolio(d) {
  return [
    `Nueva solicitud de servicio — ${d.folio}`,
    ``,
    `Cliente:   ${d.cliente}`,
    `Teléfono:  ${d.telefono}`,
    `Correo:    ${d.correo}`,
    `Servicio:  ${d.servicio}`,
    `Plaga:     ${d.plaga}`,
    `Inmueble:  ${d.inmueble} · ${d.tamano}`,
    `Dirección: ${d.direccionCompleta}`,
    `Fecha:     ${d.fecha} · ${d.horario}`,
    d.notas ? `Notas:     ${d.notas}` : null,
    ``,
    `Subtotal: ${currency(d.subtotal)}`,
    (d.descuento || 0) > 0 ? `Descuento: -${currency(d.descuento)}` : null,
    `IVA (16%): ${currency(d.iva)}`,
    `Total estimado: ${currency(d.total)}`,
  ].filter((l) => l !== null).join("\n");
}

/* Enlace de respaldo: abre el correo del usuario con el folio ya redactado */
const mailtoFolio = (d) =>
  `mailto:${EMAIL_EMPRESA}?subject=${encodeURIComponent(`Nueva solicitud ${d.folio}`)}&body=${encodeURIComponent(textoFolio(d))}`;

/* ============================================================
   HEX MESH
   ============================================================ */

function HexMesh({ color = "#FFFFFF", opacity = 0.08, className = "", id }) {
  const pid = `hexmesh-${id}`;
  return (
    <svg className={className} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id={pid} width="34" height="59" patternUnits="userSpaceOnUse">
          <path d="M17 0 L34 9.8 L34 29.5 L17 39.3 L0 29.5 L0 9.8 Z" fill="none" stroke={color} strokeWidth="1" opacity={opacity} />
          <path d="M17 39.3 L34 49 L34 59 M0 49 L0 59 M0 29.5 L-17 39.3 M34 29.5 L51 39.3" fill="none" stroke={color} strokeWidth="1" opacity={opacity} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${pid})`} />
    </svg>
  );
}

/* Íconos de plagas: línea limpia, mismo grosor y margen interno (no se salen del círculo) */
function PestGlyph({ id, size = 40, stroke = "currentColor" }) {
  const body = { fill:stroke, fillOpacity:0.1, stroke, strokeWidth:1.7, strokeLinecap:"round", strokeLinejoin:"round" };
  const wing = { ...body, fillOpacity:0.05, strokeWidth:1.4 };
  const line = { fill:"none", stroke, strokeWidth:1.5, strokeLinecap:"round", strokeLinejoin:"round" };
  const dot  = { fill:stroke, stroke:"none" };
  const box  = (ch) => <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">{ch}</svg>;
  switch (id) {
    case "cucarachas": return box(<g>
      <path {...line} d="M22 10.5 Q19 6.5 15.5 7 M26 10.5 Q29 6.5 32.5 7" />
      <circle {...body} cx="24" cy="13" r="3.6" />
      <ellipse {...body} cx="24" cy="27.5" rx="8" ry="12.5" />
      <path {...line} d="M24 17 V39" strokeWidth="1.2" opacity="0.55" />
      <path {...line} d="M16.3 22 L10.5 19 M31.7 22 L37.5 19 M16 28 L9.5 28.5 M32 28 L38.5 28.5 M17 34 L11.5 38.5 M31 34 L36.5 38.5" />
    </g>);
    case "hormigas": return box(<g>
      <path {...line} d="M22.6 8.6 L19.5 5.5 M25.4 8.6 L28.5 5.5" />
      <circle {...body} cx="24" cy="11.5" r="3.3" />
      <ellipse {...body} cx="24" cy="20" rx="3" ry="3.6" />
      <ellipse {...body} cx="24" cy="32" rx="5.6" ry="7.8" />
      <path {...line} d="M21.5 18.5 L14.5 14.5 M26.5 18.5 L33.5 14.5 M21 21 L13.5 22.5 M27 21 L34.5 22.5 M22 23 L16 29.5 M26 23 L32 29.5" />
    </g>);
    case "roedores": return box(<g>
      <path {...line} d="M10.8 23.3 C8.4 17.8 13.4 15 15.4 21" />
      <path {...line} d="M17.3 21.1 C16.8 15.2 23.2 14.2 24.6 19.9" />
      <path {...body} d="M7.5 28.6 C7.8 24.6 11.5 21.3 16.5 21.1 C21 20.9 22.5 20 26 19.6 C33 19 38.6 23 38.8 29.5 C39 33.8 35.5 36 30.5 36 L22.5 36 C19.8 36 18.4 35 18.2 33.3 C15 33 10 32 8.3 30.6 C7.6 30 7.4 29.4 7.5 28.6 Z" />
      <path {...line} d="M33.5 35 C30.4 33 30.4 28.6 33.5 26" strokeWidth="1.3" opacity="0.6" />
      <path {...line} d="M38.4 32.8 C45.8 33.2 46 21 41.6 10.5" />
      <path {...line} d="M17.5 33.6 L16.6 39 L13.4 39 M22.2 36 L22.6 39 L19.4 39 M32.6 36 L33 39 L37 39" />
      <path {...line} d="M9.4 27.5 L4 25.6 M9.2 29 L3.8 30.2 M10.2 26.3 L5.6 22.6" strokeWidth="1.2" />
      <circle {...dot} cx="15.8" cy="25.2" r="1.05" />
      <circle {...dot} cx="7.9" cy="28.3" r="1.2" />
    </g>);
    case "termitas": return box(<g>
      <path {...line} d="M22.7 8 L20 5 M25.3 8 L28 5" />
      <circle {...body} cx="24" cy="10.8" r="3" />
      <ellipse {...wing} cx="16.5" cy="22.5" rx="10" ry="2.7" transform="rotate(-38 16.5 22.5)" />
      <ellipse {...wing} cx="31.5" cy="22.5" rx="10" ry="2.7" transform="rotate(38 31.5 22.5)" />
      <ellipse {...body} cx="24" cy="17.8" rx="3.2" ry="3" />
      <ellipse {...body} cx="24" cy="31.5" rx="5" ry="9" />
    </g>);
    case "moscas": return box(<g>
      <ellipse {...wing} cx="16.8" cy="28" rx="10.5" ry="4" transform="rotate(-48 16.8 28)" />
      <ellipse {...wing} cx="31.2" cy="28" rx="10.5" ry="4" transform="rotate(48 31.2 28)" />
      <circle {...body} cx="24" cy="13.5" r="4.4" />
      <circle {...dot} cx="21.3" cy="12.6" r="1.1" />
      <circle {...dot} cx="26.7" cy="12.6" r="1.1" />
      <ellipse {...body} cx="24" cy="27" rx="5.2" ry="8.8" />
      <path {...line} d="M20.3 20.5 L15.5 17.5 M27.7 20.5 L32.5 17.5" />
    </g>);
    case "mosquitos": return box(<g>
      <path {...line} d="M24 13.8 V6" />
      <circle {...body} cx="24" cy="16.6" r="2.7" />
      <ellipse {...wing} cx="17" cy="26" rx="10" ry="2.5" transform="rotate(-62 17 26)" />
      <ellipse {...wing} cx="31" cy="26" rx="10" ry="2.5" transform="rotate(62 31 26)" />
      <ellipse {...body} cx="24" cy="29" rx="2.9" ry="9.2" />
      <path {...line} d="M22 22.5 L13 20 L9.5 26 M26 22.5 L35 20 L38.5 26 M21.5 30 L12 32.5 L9 39 M26.5 30 L36 32.5 L39 39" />
    </g>);
    case "aranas": return box(<g>
      <circle {...body} cx="24" cy="19" r="3.8" />
      <ellipse {...body} cx="24" cy="30" rx="6" ry="7.6" />
      <circle {...dot} cx="22.6" cy="18" r="0.9" />
      <circle {...dot} cx="25.4" cy="18" r="0.9" />
      <path {...line} d="M20.6 17.2 Q13 9 8 12.5 M20.2 19.6 Q12 15.5 7 19.5 M20.4 22 Q12 22 8 28.5 M21 24 Q15 28.5 12.5 37" />
      <path {...line} d="M27.4 17.2 Q35 9 40 12.5 M27.8 19.6 Q36 15.5 41 19.5 M27.6 22 Q36 22 40 28.5 M27 24 Q33 28.5 35.5 37" />
    </g>);
    case "chinches": return box(<g>
      <path {...line} d="M22 14.2 L19.2 10.5 M26 14.2 L28.8 10.5" />
      <ellipse {...body} cx="24" cy="17" rx="4.4" ry="3.2" />
      <ellipse {...body} cx="24" cy="29" rx="11" ry="9.5" />
      <path {...line} d="M14.6 27 Q24 30.5 33.4 27 M15.4 32.2 Q24 35.8 32.6 32.2" strokeWidth="1.2" opacity="0.55" />
      <path {...line} d="M14 23.5 L7.5 20.5 M13 28.5 L6.5 29 M14.5 34 L9 38 M34 23.5 L40.5 20.5 M35 28.5 L41.5 29 M33.5 34 L39 38" />
    </g>);
    default: return null;
  }
}

/* ============================================================
   UI COMPARTIDA
   ============================================================ */

function Badge({ estado }) {
  const s = ESTADO_STYLE[estado] || ESTADO_STYLE["Pendiente"];
  return <span className="badge" style={{ background:s.bg, color:s.fg }}><span className="badge-dot" style={{ background:s.dot }} />{estado}</span>;
}

function TicketFrame({ children, className = "" }) {
  return (
    <div className={`ticket ${className}`}>
      <div className="ticket-notch ticket-notch-left" /><div className="ticket-notch ticket-notch-right" />
      {children}
    </div>
  );
}

function Toast({ message, onClose }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onClose, 3200);
    return () => clearTimeout(t);
  }, [message, onClose]);
  if (!message) return null;
  return <div className="toast"><CircleCheck size={18} /><span>{message}</span></div>;
}

/* ── Campo de formulario (fuera de los componentes de página para que los inputs NO pierdan el foco) ── */
function Field({ label, name, form, update, errors, type="text", placeholder, icon: Icon, min, inputMode, maxLength }) {
  return (
    <label>{label}
      <div className="input-wrap">
        {Icon && <Icon size={16}/>}
        <input type={type} value={form[name]} onChange={(e)=>update(name,e.target.value)} placeholder={placeholder} min={min} inputMode={inputMode} maxLength={maxLength}/>
      </div>
      {errors[name] && <span className="field-error">{errors[name]}</span>}
    </label>
  );
}

/* ── Modal genérico ── */
function Modal({ title, onClose, children }) {
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ── Botón de eliminar con confirmación inline ── */
function DeleteBtn({ onDelete, label }) {
  const [confirm, setConfirm] = useState(false);
  if (confirm)
    return (
      <span style={{ display:"inline-flex", gap:4 }}>
        <button className="btn-del-confirm" onClick={onDelete}>Sí, eliminar</button>
        <button className="btn-del-cancel" onClick={() => setConfirm(false)}>No</button>
      </span>
    );
  return (
    <button className="btn-del" title={`Eliminar ${label}`} onClick={() => setConfirm(true)}>
      <Trash2 size={14} />
    </button>
  );
}

/* ── Botón "Vaciar todo" con confirmación inline ── */
function ClearAllBtn({ onClear, count, label }) {
  const [confirm, setConfirm] = useState(false);
  if (confirm)
    return (
      <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
        <span className="dim" style={{ color:"#dc2626", fontWeight:600 }}>¿Vaciar {count} {label}?</span>
        <button className="btn-del-confirm" onClick={() => { onClear(); setConfirm(false); }}>Sí, vaciar</button>
        <button className="btn-del-cancel" onClick={() => setConfirm(false)}>Cancelar</button>
      </span>
    );
  return (
    <button className="btn btn-outline btn-clear" disabled={count === 0} onClick={() => setConfirm(true)}>
      <Trash2 size={15}/> Vaciar todo
    </button>
  );
}

/* ============================================================
   NAVEGACIÓN
   ============================================================ */

function Nav({ page, setPage, usuario, onLogout }) {
  const [open, setOpen] = useState(false);
  const items = [
    { id:"home",      label:"Inicio"             },
    { id:"cotizador", label:"Cotizador"          },
    { id:"catalogo",  label:"Catálogo de plagas" },
  ];
  const go = (id) => { setPage(id); setOpen(false); window.scrollTo({ top:0, behavior:"smooth" }); };
  return (
    <header className="nav">
      <div className="nav-inner">
        <button className="brand" onClick={() => go("home")} aria-label="Inicio">
          <span className="brand-mark">
            <svg width="26" height="26" viewBox="0 0 26 26">
              <path d="M13 1.5 L23.5 7.5 V19.5 L13 25.5 L2.5 19.5 V7.5 Z" fill="none" stroke="#FFFFFF" strokeWidth="1.4" />
              <path d="M13 7.5 L18.5 10.7 V17 L13 20.2 L7.5 17 V10.7 Z" fill="#4DB6AC" opacity="0.85" />
            </svg>
          </span>
          <span className="brand-text"><strong>MARRÓN KING</strong><em>Control de plagas</em></span>
        </button>

        <nav className="nav-links">
          {items.map((it) => (
            <button key={it.id} className={`nav-link ${page===it.id?"is-active":""}`} onClick={() => go(it.id)}>{it.label}</button>
          ))}
        </nav>

        <div className="nav-actions">
          {usuario ? (
            <>
              <span className="nav-user-label"><ShieldCheck size={14} /> {usuario.nombre} · <em>{usuario.rol}</em></span>
              <button className="btn btn-ghost-inv nav-admin" onClick={() => go("admin")}><LayoutDashboard size={16} /> Panel</button>
              <button className="btn btn-ghost-inv nav-admin" onClick={onLogout}><LogOut size={16} /> Salir</button>
            </>
          ) : (
            <button className="btn btn-ghost-inv nav-admin" onClick={() => go("login")}><Lock size={16} /> Acceso empresa</button>
          )}
          <button className="btn btn-accent nav-cta" onClick={() => go("cotizador")}>Cotizar ahora</button>
          <button className="nav-burger" onClick={() => setOpen((v) => !v)} aria-label="Menú">{open ? <X size={22}/> : <Menu size={22}/>}</button>
        </div>
      </div>
      {open && (
        <div className="nav-mobile">
          {[...items, { id:usuario?"admin":"login", label:usuario?"Panel admin":"Acceso empresa" }].map((it) => (
            <button key={it.id} className="nav-mobile-link" onClick={() => go(it.id)}>{it.label}<ChevronRight size={16}/></button>
          ))}
          {usuario && <button className="nav-mobile-link" onClick={() => { setOpen(false); onLogout(); }}>Cerrar sesión<LogOut size={16}/></button>}
          <button className="btn btn-accent" style={{ marginTop:10 }} onClick={() => go("cotizador")}>Cotizar ahora</button>
        </div>
      )}
    </header>
  );
}

function Footer({ setPage }) {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <span className="brand-text" style={{ color:"#fff" }}><strong>MARRÓN KING</strong><em>Control de plagas</em></span>
          <p className="footer-copy">Cotización, solicitud y seguimiento de servicios de fumigación en un solo sistema.</p>
        </div>
        <div className="footer-col">
          <span className="footer-title">Sistema</span>
          <button onClick={() => setPage("cotizador")}>Cotizador</button>
          <button onClick={() => setPage("catalogo")}>Catálogo de plagas</button>
          <button onClick={() => setPage("login")}>Panel administrativo</button>
        </div>
        <div className="footer-col">
          <span className="footer-title">Contacto</span>
          <span><Phone size={14}/> 81 8000 1234</span>
          <span><Mail size={14}/> hola@marronking.mx</span>
          <span><MapPin size={14}/> Área metropolitana</span>
        </div>
      </div>
      <div className="footer-bottom">Proyecto Marrón King — sistema de demostración, sin conexión a base de datos.</div>
    </footer>
  );
}

/* ============================================================
   PÁGINA: INICIO
   ============================================================ */

function HomePage({ setPage }) {
  const demo = money(1140);
  const problems = [
    { icon:FileText,      title:"Cotizaciones manuales",      desc:"Se calculan a mano, sin un proceso estandarizado."        },
    { icon:AlertTriangle, title:"Solicitudes desorganizadas", desc:"Riesgo de pérdida o extravío de información."             },
    { icon:Search,        title:"Seguimiento difícil",        desc:"No hay forma clara de dar trazabilidad al servicio."     },
    { icon:Users,         title:"Datos dispersos",            desc:"Información de clientes sin centralizar."                 },
    { icon:Clock,         title:"Tiempo desperdiciado",       desc:"Se responden las mismas preguntas una y otra vez."        },
  ];
  const steps = [
    { n:"01", title:"Cliente",      desc:"Ingresa al sitio y selecciona el servicio que necesita."       },
    { n:"02", title:"Cotización",   desc:"El sistema calcula un precio estimado según lo seleccionado."  },
    { n:"03", title:"Solicitud",    desc:"El cliente confirma servicio, fecha, horario y sus datos."     },
    { n:"04", title:"Confirmación", desc:"Se genera un folio y un comprobante."                          },
    { n:"05", title:"Empresa",      desc:"El encargado recibe la solicitud y la gestiona desde el panel."},
  ];
  return (
    <>
      <section className="hero">
        <div className="hero-photo" style={{ backgroundImage: `url(${heroImg})` }} />
        <div className="hero-photo-tint" />
        <HexMesh id="hero" color="#FFFFFF" opacity={0.16} className="hero-mesh" />
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="eyebrow">Sistema de gestión de fumigación</span>
            <h1>Una cotización clara,<br />un folio de por medio.</h1>
            <p className="hero-lead">
              Selecciona el inmueble, la plaga y el tamaño del área. El sistema calcula
              el estimado al instante y da seguimiento a tu solicitud de principio a fin.
            </p>
            <div className="hero-actions">
              <button className="btn btn-accent btn-lg" onClick={() => setPage("cotizador")}>Cotizar mi servicio <ArrowRight size={18}/></button>
              <button className="btn btn-ghost-inv btn-lg" onClick={() => setPage("catalogo")}>Ver catálogo de plagas</button>
            </div>
            <div className="hero-stats">
              <div><strong>5</strong><span>tipos de servicio</span></div>
              <div><strong>&lt; 2 min</strong><span>para cotizar</span></div>
              <div><strong>1 folio</strong><span>por solicitud</span></div>
            </div>
          </div>
          <div className="hero-visual">
            <TicketFrame className="hero-ticket">
              <div className="ticket-head"><span>FOLIO DE SERVICIO</span><ShieldCheck size={16}/></div>
              <div className="ticket-folio">MK-2026-04213</div>
              <div className="ticket-row"><span>Servicio</span><strong>Fumigación general</strong></div>
              <div className="ticket-row"><span>Inmueble</span><strong>Casa habitación</strong></div>
              <div className="ticket-row"><span>Tamaño</span><strong>50 – 150 m²</strong></div>
              <div className="ticket-row"><span>Fecha</span><strong>28 ago · 10:00–12:00</strong></div>
              <div className="ticket-divider"/>
              <div className="ticket-row"><span>Subtotal</span><strong>{currency(demo.subtotal)}</strong></div>
              <div className="ticket-row"><span>IVA (16%)</span><strong>{currency(demo.iva)}</strong></div>
              <div className="ticket-row ticket-total"><span>Total</span><strong>{currency(demo.total)}</strong></div>
            </TicketFrame>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow eyebrow-dark">Problemática actual</span>
          <h2>Coordinar por teléfono o WhatsApp tiene un costo</h2>
          <p>La mayoría de las solicitudes de fumigación aún se gestionan de manera informal.</p>
        </div>
        <div className="problem-grid">
          {problems.map((p, i) => (
            <div className="problem-card" key={i}><p.icon size={20}/><h3>{p.title}</h3><p>{p.desc}</p></div>
          ))}
        </div>
      </section>

      <section className="section section-tint">
        <div className="section-head">
          <span className="eyebrow eyebrow-dark">Cómo funciona</span>
          <h2>Del clic al folio, en cinco pasos</h2>
        </div>
        <div className="steps-row">
          {steps.map((s, i) => (
            <React.Fragment key={s.n}>
              <div className="step-item">
                <span className="step-num">{s.n}</span><h3>{s.title}</h3><p>{s.desc}</p>
              </div>
              {i < steps.length - 1 && <div className="step-connector"/>}
            </React.Fragment>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="cta-band">
          <HexMesh id="cta" color="#FFFFFF" opacity={0.08} className="cta-mesh"/>
          <div className="cta-band-inner">
            <div><h2>¿Listo para cotizar tu servicio?</h2><p>Selecciona tus opciones y recibe un estimado antes de solicitar la visita.</p></div>
            <button className="btn btn-accent btn-lg" onClick={() => setPage("cotizador")}>Empezar cotización <ArrowRight size={18}/></button>
          </div>
        </div>
      </section>
    </>
  );
}

/* ============================================================
   LOGIN
   ============================================================ */

function LoginPage({ setPage, onLogin }) {
  const [correo, setCorreo]         = useState("");
  const [contrasena, setContrasena] = useState("");
  const [error, setError]           = useState("");
  const [enviando, setEnviando]     = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    try {
      const r = await api("/auth/login", { method:"POST", body:{ correo:correo.trim(), contrasena } });
      onLogin(r.usuario); setPage("admin");
    } catch (err) {
      setError(err.message); setEnviando(false);
    }
  };
  return (
    <section className="section login-wrap">
      <div className="login-card">
        <div className="login-head"><ShieldCheck size={32}/><h1>Acceso empresa</h1><p>Ingresa tus credenciales para acceder al panel administrativo.</p></div>
        <form className="form" onSubmit={submit} noValidate>
          <label>Correo electrónico<div className="input-wrap"><Mail size={16}/><input type="email" value={correo} onChange={(e)=>{setCorreo(e.target.value); setError("");}} placeholder="correo@marronking.mx"/></div></label>
          <label>Contraseña<div className="input-wrap"><Lock size={16}/><input type="password" value={contrasena} onChange={(e)=>{setContrasena(e.target.value); setError("");}} placeholder="••••••••"/></div></label>
          {error && <span className="field-error">{error}</span>}
          <button className="btn btn-accent btn-lg" type="submit" disabled={enviando} style={{ marginTop:6 }}>{enviando ? "Entrando…" : <>Iniciar sesión <ArrowRight size={16}/></>}</button>
        </form>
        <p className="login-hint">Demo: <code>admin@marronking.mx</code> / <code>admin123</code></p>
      </div>
    </section>
  );
}

/* Muestra "cargando" o el error de conexión mientras llega el catálogo de la base de datos */
function CatalogGate({ cat, error, onRetry, children }) {
  if (cat) return children;
  return (
    <section className="section empty-state">
      {error ? (
        <>
          <AlertTriangle size={28}/>
          <h2>No se pudo conectar con el servidor</h2>
          <p>{error}</p>
          <button className="btn btn-accent" onClick={onRetry}>Reintentar</button>
        </>
      ) : (
        <><Clock size={28}/><h2>Cargando…</h2></>
      )}
    </section>
  );
}

/* ============================================================
   COTIZADOR — 5 PASOS
   ============================================================ */

function CotizadorPage({ cat, quote, setQuote, setPage, setToast }) {
  const [step, setStep] = useState(1);
  const totalSteps = 5;
  const sel    = quote.selections;
  const setSel = (patch) => setQuote((q) => ({ ...q, selections:{ ...q.selections, ...patch } }));
  const canNext = { 1:!!sel.propertyId, 2:!!sel.pestId, 3:!!sel.sizeId, 4:!!sel.serviceId, 5:true }[step];
  const result  = useMemo(() => computeQuote(sel, cat), [sel, cat]);
  const recomendado = cat.plagas.find((p) => p.id === sel.pestId)?.servicio_id;
  const goSolicitar = () => {
    if (!result) return;
    setQuote((q) => ({ ...q, result }));
    setToast("Cotización lista. Completa tus datos para solicitar el servicio.");
    setPage("solicitud");
  };
  const stepLabels = ["Inmueble","Plaga","Tamaño","Servicio","Estimado"];
  return (
    <section className="section quoter">
      <div className="quoter-header">
        <span className="eyebrow eyebrow-dark">Cotizador automático</span>
        <h1>Arma tu cotización</h1>
        <p>Responde cinco preguntas y obtén un estimado inmediato.</p>
      </div>
      <div className="stepper">
        {stepLabels.map((label, i) => {
          const n = i+1; const state = n===step?"current":n<step?"done":"pending";
          return (
            <React.Fragment key={label}>
              <button className={`stepper-item stepper-${state}`} onClick={() => n<step&&setStep(n)} disabled={n>step}>
                <span className="stepper-dot">{state==="done"?<Check size={13}/>:n}</span>
                <span className="stepper-label">{label}</span>
              </button>
              {i < stepLabels.length-1 && <span className="stepper-line"/>}
            </React.Fragment>
          );
        })}
      </div>
      <div className="quoter-body">
        {step===1 && <div className="option-grid">{cat.inmuebles.map((p) => { const Icon = INMUEBLE_ICONS[p.tipo] || Building2; return <button key={p.id} className={`option-card ${sel.propertyId===p.id?"is-selected":""}`} onClick={()=>setSel({propertyId:p.id})}><Icon size={22}/><div><strong>{p.tipo}</strong><span>{p.descripcion}</span></div>{sel.propertyId===p.id&&<Check className="option-check" size={16}/>}</button>; })}</div>}
        {/* Al elegir la plaga se preselecciona el servicio recomendado */}
        {step===2 && <div className="option-grid option-grid-pest">{cat.plagas.map((p) => <button key={p.id} className={`option-card ${sel.pestId===p.id?"is-selected":""}`} onClick={()=>setSel({pestId:p.id, serviceId:p.servicio_id ?? sel.serviceId})}><span className="pest-glyph"><PestGlyph id={glyphKey(p.nombre)} size={34}/></span><div><strong>{p.nombre}</strong><span>{p.signos[0]}</span></div>{sel.pestId===p.id&&<Check className="option-check" size={16}/>}</button>)}</div>}
        {step===3 && <div className="option-grid">{cat.tamanos.map((s) => <button key={s.id} className={`option-card ${sel.sizeId===s.id?"is-selected":""}`} onClick={()=>setSel({sizeId:s.id})}><span className="size-tag">m²</span><div><strong>{s.rango_m2}</strong><span>{s.descripcion}</span></div>{sel.sizeId===s.id&&<Check className="option-check" size={16}/>}</button>)}</div>}
        {step===4 && <div className="option-grid">{cat.servicios.map((s) => <button key={s.id} className={`option-card option-card-wide ${sel.serviceId===s.id?"is-selected":""}`} onClick={()=>setSel({serviceId:s.id})}><span className="service-code">{s.codigo}</span><div><strong>{s.nombre} {s.id===recomendado && <em className="dim" style={{ color:"#00695C", fontStyle:"normal", fontWeight:600 }}>· Recomendado para esta plaga</em>}</strong><span>{s.descripcion}</span></div>{sel.serviceId===s.id&&<Check className="option-check" size={16}/>}</button>)}</div>}
        {step===5 && result && (
          <div className="result-wrap">
            <TicketFrame className="result-ticket">
              <div className="ticket-head"><span>ESTIMADO DE SERVICIO</span><ShieldCheck size={16}/></div>
              <div className="ticket-row"><span>Inmueble</span><strong>{result.prop.tipo}</strong></div>
              <div className="ticket-row"><span>Plaga</span><strong>{result.pest.nombre}</strong></div>
              <div className="ticket-row"><span>Tamaño</span><strong>{result.size.rango_m2}</strong></div>
              <div className="ticket-row"><span>Servicio</span><strong>{result.service.nombre}</strong></div>
              <div className="ticket-divider"/>
              <div className="ticket-row"><span>Subtotal</span><strong>{currency(result.subtotal)}</strong></div>
              {result.descuento > 0 && <div className="ticket-row"><span>Descuento{result.promo ? ` (${result.promo.nombre})` : ""}</span><strong>-{currency(result.descuento)}</strong></div>}
              <div className="ticket-row"><span>IVA (16%)</span><strong>{currency(result.iva)}</strong></div>
              <div className="ticket-row"><span>Rango estimado</span><strong>{currency(result.low)} – {currency(result.high)}</strong></div>
              <div className="ticket-row ticket-total"><span>Total sugerido</span><strong>{currency(result.total)}</strong></div>
              <p className="ticket-note">Estimado no vinculante. El precio final se confirma al agendar la visita.</p>
            </TicketFrame>
            <div className="result-side">
              <h3>¿Qué sigue?</h3>
              <ul className="result-list">
                <li><CircleDot size={14}/> Registra tus datos y la dirección exacta.</li>
                <li><CircleDot size={14}/> Elige fecha y horario disponible.</li>
                <li><CircleDot size={14}/> Recibe tu folio y comprobante al confirmar.</li>
              </ul>
              <button className="btn btn-accent btn-lg" onClick={goSolicitar}>Solicitar este servicio <ArrowRight size={18}/></button>
            </div>
          </div>
        )}
      </div>
      <div className="quoter-nav">
        <button className="btn btn-outline" onClick={() => setStep((s)=>Math.max(1,s-1))} disabled={step===1}><ArrowLeft size={16}/> Atrás</button>
        {step<totalSteps && <button className="btn btn-primary" onClick={() => setStep((s)=>Math.min(totalSteps,s+1))} disabled={!canNext}>Siguiente <ArrowRight size={16}/></button>}
      </div>
    </section>
  );
}

/* ============================================================
   SOLICITUD
   ============================================================ */

function SolicitudPage({ cat, quote, setPage, setToast }) {
  const [form, setForm] = useState({ nombre:"", apellido_paterno:"", apellido_materno:"", telefono:"", correo:"", confirmacionCorreo:"", calle:"", numero:"", colonia:"", codigo_postal:"", rfc:"", fecha:"", horario:"", notas:"" });
  const [errors, setErrors]       = useState({});
  const [confirmed, setConfirmed] = useState(null);
  const [envio, setEnvio]         = useState("");      // "" | enviado | pendiente
  const [enviando, setEnviando]   = useState(false);
  const result = quote.result;
  if (!result) return <section className="section empty-state"><Info size={28}/><h2>Primero arma tu cotización</h2><p>Necesitamos saber qué servicio necesitas antes de tomar tus datos.</p><button className="btn btn-accent" onClick={()=>setPage("cotizador")}>Ir al cotizador</button></section>;
  const update = (k, v) => {
    setForm((f) => ({ ...f, [k]:v }));
    setErrors((e) => (e[k] ? { ...e, [k]:undefined } : e));
  };
  const hoy = todayStr();
  const validate = () => {
    const e = {};
    if (!form.nombre.trim())           e.nombre           = "Ingresa tu nombre.";
    if (!form.apellido_paterno.trim()) e.apellido_paterno = "Ingresa apellido paterno.";
    if (!form.apellido_materno.trim()) e.apellido_materno = "Ingresa apellido materno.";
    if (soloDigitos(form.telefono).length !== 10) e.telefono = "Ingresa un teléfono de 10 dígitos.";
    if (!EMAIL_RE.test(form.correo.trim()))       e.correo   = "Correo inválido.";
    if (form.correo.trim().toLowerCase()!==form.confirmacionCorreo.trim().toLowerCase()) e.confirmacionCorreo="Los correos no coinciden.";
    if (form.rfc.trim() && !RFC_RE.test(form.rfc.trim())) e.rfc = "RFC inválido.";
    if (!form.calle.trim())       e.calle   = "Ingresa la calle.";
    if (!form.numero.trim())      e.numero  = "Ingresa el número.";
    if (!form.colonia.trim())     e.colonia = "Ingresa la colonia.";
    if (!/^\d{5}$/.test(form.codigo_postal.trim())) e.codigo_postal = "El código postal debe tener 5 dígitos.";
    if (!form.fecha)              e.fecha   = "Selecciona una fecha.";
    else if (form.fecha < hoy)    e.fecha   = "La fecha no puede ser anterior a hoy.";
    if (!form.horario)            e.horario = "Selecciona un horario.";
    setErrors(e); return Object.keys(e).length === 0;
  };
  const submit = async (ev) => {
    ev.preventDefault();
    if (enviando || !validate()) return;
    setEnviando(true);
    const s = quote.selections;
    try {
      const r = await api("/solicitudes", { method:"POST", body:{
        cliente:    { nombre:form.nombre, apellido_paterno:form.apellido_paterno, apellido_materno:form.apellido_materno, telefono:form.telefono, correo:form.correo, rfc:form.rfc },
        direccion:  { calle:form.calle, numero:form.numero, colonia:form.colonia, codigo_postal:form.codigo_postal },
        cotizacion: { inmueble_id:s.propertyId, plaga_id:s.pestId, tamano_id:s.sizeId, servicio_id:s.serviceId },
        fecha:form.fecha, horario:form.horario, notas:form.notas,
      }});
      const o = r.solicitud;   // el precio y el folio los define el servidor
      setConfirmed({
        folio:o.folio, cliente:o.cliente, telefono:fmtTel(o.telefono_cliente), correo:o.correo_cliente,
        servicio:o.servicio, plaga:o.plaga, inmueble:o.inmueble, tamano:o.tamano, direccionCompleta:o.direccion,
        fecha:o.fecha_servicio, horario:o.horario, notas:o.notas || "",
        subtotal:o.subtotal, descuento:o.descuento, iva:o.iva, total:o.total,
      });
      setEnvio(r.correo_enviado ? "enviado" : "pendiente");
      setToast(r.correo_enviado ? "Folio enviado al correo de la empresa." : "Solicitud registrada.");
    } catch (err) {
      if (err.campos && Object.keys(err.campos).length) setErrors(err.campos);
      setToast(err.message);
    } finally {
      setEnviando(false);
    }
  };
  const descargarPdf = () => {
    try { generarPdfComprobante(confirmed); setToast("Comprobante descargado."); }
    catch (err) { console.error(err); setToast("No se pudo generar el PDF."); }
  };
  if (confirmed) return (
    <section className="section confirm-wrap">
      <div className="confirm-head"><CircleCheck size={30}/><h1>Solicitud confirmada</h1><p>Guarda tu folio: te servirá para dar seguimiento al servicio.</p></div>
      <TicketFrame className="confirm-ticket">
        <div className="ticket-head"><span>COMPROBANTE DE SOLICITUD</span><ShieldCheck size={16}/></div>
        <div className="ticket-folio">{confirmed.folio}</div>
        <div className="ticket-row"><span>Cliente</span><strong>{confirmed.cliente}</strong></div>
        <div className="ticket-row"><span>Servicio</span><strong>{confirmed.servicio}</strong></div>
        <div className="ticket-row"><span>Inmueble</span><strong>{confirmed.inmueble} · {confirmed.tamano}</strong></div>
        <div className="ticket-row"><span>Dirección</span><strong>{confirmed.direccionCompleta}</strong></div>
        <div className="ticket-row"><span>Fecha</span><strong>{confirmed.fecha} · {confirmed.horario}</strong></div>
        <div className="ticket-divider"/>
        <div className="ticket-row"><span>Subtotal</span><strong>{currency(confirmed.subtotal)}</strong></div>
        {confirmed.descuento > 0 && <div className="ticket-row"><span>Descuento</span><strong>-{currency(confirmed.descuento)}</strong></div>}
        <div className="ticket-row"><span>IVA (16%)</span><strong>{currency(confirmed.iva)}</strong></div>
        <div className="ticket-row ticket-total"><span>Total estimado</span><strong>{currency(confirmed.total)}</strong></div>
        <p className="ticket-note">Conserva este comprobante: el folio sirve para dar seguimiento a tu servicio.</p>
      </TicketFrame>
      <div className={`envio-status envio-${envio}`}>
        {envio === "enviado" && <span><CircleCheck size={15}/> Folio enviado al correo de la empresa.</span>}
        {envio === "pendiente" && (
          <span>
            <AlertTriangle size={15}/> Tu solicitud quedó registrada. El aviso por correo a la empresa está pendiente.{" "}
            <a href={mailtoFolio(confirmed)}>Enviarlo desde mi correo</a>
          </span>
        )}
      </div>
      <div className="confirm-actions">
        <button className="btn btn-outline" onClick={descargarPdf}><FileDown size={16}/> Descargar PDF</button>
        <button className="btn btn-primary" onClick={()=>setPage("home")}>Volver al inicio</button>
      </div>
    </section>
  );
  const fp = { form, update, errors };
  return (
    <section className="section solicitud-wrap">
      <div className="solicitud-form-col">
        <span className="eyebrow eyebrow-dark">Solicitud de servicio</span>
        <h1>Completa tus datos</h1>
        <p>Con esta información generamos tu folio y avisamos al encargado.</p>
        <form className="form" onSubmit={submit} noValidate>
          <p className="form-section-title">Datos personales</p>
          <div className="form-row form-row-3">
            <Field {...fp} label="Nombre(s)" name="nombre" placeholder="Nombre(s)"/>
            <Field {...fp} label="Apellido Paterno" name="apellido_paterno" placeholder="Apellido paterno"/>
            <Field {...fp} label="Apellido Materno" name="apellido_materno" placeholder="Apellido materno"/>
          </div>
          <div className="form-row form-row-2">
            <Field {...fp} label="Teléfono" name="telefono" icon={Phone} placeholder="81 0000 0000" inputMode="tel"/>
            <Field {...fp} label="RFC (opcional)" name="rfc" placeholder="XXXX000000XX0" maxLength={13}/>
          </div>
          <div className="form-row form-row-2">
            <Field {...fp} label="Correo electrónico" name="correo" icon={Mail} placeholder="correo@ejemplo.com"/>
            <Field {...fp} label="Confirmación de correo" name="confirmacionCorreo" icon={Mail} placeholder="Repite tu correo"/>
          </div>
          <p className="form-section-title">Dirección del inmueble</p>
          <div className="form-row form-row-2">
            <Field {...fp} label="Calle" name="calle" icon={MapPin} placeholder="Nombre de la calle"/>
            <Field {...fp} label="Número" name="numero" placeholder="Ej. 220-B"/>
          </div>
          <div className="form-row form-row-2">
            <Field {...fp} label="Colonia" name="colonia" placeholder="Nombre de la colonia"/>
            <Field {...fp} label="Código Postal" name="codigo_postal" placeholder="5 dígitos" inputMode="numeric" maxLength={5}/>
          </div>
          <p className="form-section-title">Fecha y horario</p>
          <div className="form-row form-row-2">
            <Field {...fp} label="Fecha" name="fecha" type="date" icon={Calendar} min={hoy}/>
            <label>Horario<div className="input-wrap"><Clock size={16}/><select value={form.horario} onChange={(e)=>update("horario",e.target.value)}><option value="">Selecciona un horario</option>{cat.horarios.map((h)=><option key={h} value={h}>{h}</option>)}</select></div>{errors.horario&&<span className="field-error">{errors.horario}</span>}</label>
          </div>
          <div className="form-row"><label>Notas para el técnico (opcional)<textarea rows={3} value={form.notas} onChange={(e)=>update("notas",e.target.value)} placeholder="Acceso, mascotas, horario preferente, etc."/></label></div>
          <button className="btn btn-accent btn-lg" type="submit" disabled={enviando}>{enviando ? "Enviando…" : <>Confirmar solicitud <ArrowRight size={18}/></>}</button>
        </form>
      </div>
      <div className="solicitud-summary-col">
        <TicketFrame className="summary-ticket">
          <div className="ticket-head"><span>RESUMEN DE COTIZACIÓN</span><ShieldCheck size={16}/></div>
          <div className="ticket-row"><span>Servicio</span><strong>{result.service.nombre}</strong></div>
          <div className="ticket-row"><span>Inmueble</span><strong>{result.prop.tipo}</strong></div>
          <div className="ticket-row"><span>Plaga</span><strong>{result.pest.nombre}</strong></div>
          <div className="ticket-row"><span>Tamaño</span><strong>{result.size.rango_m2}</strong></div>
          <div className="ticket-divider"/>
          <div className="ticket-row"><span>Subtotal</span><strong>{currency(result.subtotal)}</strong></div>
          {result.descuento > 0 && <div className="ticket-row"><span>Descuento</span><strong>-{currency(result.descuento)}</strong></div>}
          <div className="ticket-row"><span>IVA (16%)</span><strong>{currency(result.iva)}</strong></div>
          <div className="ticket-row ticket-total"><span>Total estimado</span><strong>{currency(result.total)}</strong></div>
          <button className="btn btn-outline" style={{ width:"100%",marginTop:12 }} onClick={()=>setPage("cotizador")}>Editar cotización</button>
        </TicketFrame>
      </div>
    </section>
  );
}

/* ============================================================
   CATÁLOGO
   ============================================================ */

function CatalogoPage({ cat, setPage, setQuote }) {
  const [open, setOpen] = useState(cat.plagas[0]?.id ?? null);
  const startQuoteFor = (pest) => { setQuote((q)=>({ ...q, selections:{ ...q.selections, pestId:pest.id, serviceId:pest.servicio_id ?? q.selections.serviceId } })); setPage("cotizador"); };
  return (
    <section className="section catalog">
      <div className="section-head">
        <span className="eyebrow eyebrow-dark">Catálogo informativo</span>
        <h1>Conoce la plaga, elige el servicio</h1>
        <p>Identifica señales comunes de infestación y el tratamiento recomendado para cada caso.</p>
      </div>
      <div className="catalog-grid">
        {cat.plagas.map((p) => {
          const service = cat.servicios.find((s)=>s.id===p.servicio_id); const isOpen = open===p.id;
          return (
            <div className={`pest-card ${isOpen?"is-open":""}`} key={p.id}>
              <button className="pest-card-head" onClick={()=>setOpen(isOpen?null:p.id)}>
                <span className="pest-glyph pest-glyph-lg"><PestGlyph id={glyphKey(p.nombre)} size={40}/></span>
                <div><h3>{p.nombre}</h3>{service && <span className="pest-service-tag">Recomendado: {service.nombre}</span>}</div>
                <ChevronRight className={`pest-chevron ${isOpen?"is-rot":""}`} size={18}/>
              </button>
              {isOpen && <div className="pest-card-body"><span className="pest-body-label">Señales frecuentes</span><ul>{p.signos.map((s,i)=><li key={i}><CircleDot size={12}/> {s}</li>)}</ul><button className="btn btn-primary" onClick={()=>startQuoteFor(p)}>Cotizar para {p.nombre.toLowerCase()} <ArrowRight size={15}/></button></div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ============================================================
   PANEL ADMINISTRATIVO (datos reales desde MySQL)
   ============================================================ */

const FUENTES = {
  solicitudes:"/solicitudes", clientes:"/clientes", tecnicos:"/tecnicos", proveedores:"/proveedores",
  materiaPrima:"/materia-prima", compras:"/compras", stats:"/estadisticas",
};

function AdminPage({ cat, usuario, setToast, onSesionExpirada }) {
  const [tab, setTab]             = useState("solicitudes");
  const [filterEstado, setFilter] = useState("");
  const [search, setSearch]       = useState("");
  const [modal, setModal]         = useState(null);
  const [cargando, setCargando]   = useState(true);
  const [data, setData]           = useState({ solicitudes:[], clientes:[], tecnicos:[], proveedores:[], materiaPrima:[], compras:[], stats:null });
  const esAdmin = usuario?.rol === "Administrador";
  const { solicitudes, clientes, tecnicos, proveedores, materiaPrima, compras, stats } = data;

  const manejarError = useCallback((err) => {
    if (err.status === 401) onSesionExpirada(); else setToast(err.message);
  }, [onSesionExpirada, setToast]);

  /* Vuelve a pedir a la base de datos las listas indicadas (o todas) */
  const refrescar = useCallback(async (...claves) => {
    const lista = claves.length ? claves : Object.keys(FUENTES);
    try {
      const res = await Promise.all(lista.map((k) => api(FUENTES[k])));
      setData((d) => { const n = { ...d }; lista.forEach((k, i) => { n[k] = res[i]; }); return n; });
    } catch (err) { manejarError(err); }
  }, [manejarError]);

  useEffect(() => { refrescar().finally(() => setCargando(false)); }, [refrescar]);

  const ejecutar = async (fn) => { try { return await fn(); } catch (err) { manejarError(err); } };

  /* ─ Solicitudes ─ */
  const cambiarEstado = (o, estadoId) => ejecutar(async () => {
    const r = await api(`/solicitudes/${o.orden_id}/estado`, { method:"PATCH", body:{ estado_id:Number(estadoId) } });
    setToast([`Solicitud ${o.folio} → "${r.solicitud.estado}".`, ...(r.avisos || [])].join(" "));
    await refrescar("solicitudes", "stats", "materiaPrima", "tecnicos");
  });
  const asignarTecnico = (o, tecnicoId) => ejecutar(async () => {
    const r = await api(`/solicitudes/${o.orden_id}/tecnico`, { method:"PATCH", body:{ tecnico_id: tecnicoId ? Number(tecnicoId) : null } });
    setToast(r.solicitud.tecnico ? `Técnico ${r.solicitud.tecnico} asignado.` : `Técnico removido de ${o.folio}.`);
    await refrescar("solicitudes", "tecnicos");
  });
  const filtered = solicitudes.filter((s) => {
    const matchE = !filterEstado || String(s.estado_id) === filterEstado;
    const matchS = (s.cliente + s.folio).toLowerCase().includes(search.toLowerCase());
    return matchE && matchS;
  });

  /* ─ Técnicos ─ */
  const addTecnico = async (datos) => {
    await api("/tecnicos", { method:"POST", body:datos });
    setModal(null); setToast("Técnico agregado correctamente."); await refrescar("tecnicos");
  };
  const delTecnico = (id) => ejecutar(async () => {
    await api(`/tecnicos/${id}`, { method:"DELETE" });
    setToast("Técnico eliminado. Sus solicitudes activas regresaron a \"Pendiente\".");
    await refrescar("tecnicos", "solicitudes", "stats");
  });
  const vaciarTecnicos = () => ejecutar(async () => {
    await api("/tecnicos", { method:"DELETE" });
    setToast("Técnicos vaciados. Las solicitudes activas regresaron a \"Pendiente\".");
    await refrescar("tecnicos", "solicitudes", "stats");
  });

  /* ─ Proveedores ─ */
  const addProveedor = async (datos) => {
    await api("/proveedores", { method:"POST", body:datos });
    setModal(null); setToast("Proveedor agregado correctamente."); await refrescar("proveedores");
  };
  const delProveedor = (id) => ejecutar(async () => {
    await api(`/proveedores/${id}`, { method:"DELETE" });
    setToast("Proveedor eliminado."); await refrescar("proveedores");
  });
  const vaciarProveedores = () => ejecutar(async () => {
    await api("/proveedores", { method:"DELETE" });
    setToast("Proveedores vaciados. Los insumos quedaron sin proveedor asignado.");
    await refrescar("proveedores", "materiaPrima", "compras");
  });

  /* ─ Materia prima ─ */
  const addMateriaPrima = async (datos) => {
    await api("/materia-prima", { method:"POST", body:datos });
    setModal(null); setToast("Insumo agregado correctamente."); await refrescar("materiaPrima", "stats");
  };
  const delMateriaPrima = (id) => ejecutar(async () => {
    await api(`/materia-prima/${id}`, { method:"DELETE" });
    setToast("Insumo eliminado."); await refrescar("materiaPrima", "stats", "compras");
  });
  const vaciarMateriaPrima = () => ejecutar(async () => {
    await api("/materia-prima", { method:"DELETE" });
    setToast("Inventario de materia prima vaciado."); await refrescar("materiaPrima", "stats", "compras");
  });

  /* ─ Compras ─ */
  const addCompra = async (datos) => {
    const r = await api("/compras", { method:"POST", body:datos });
    setModal(null); setToast(`Compra registrada por ${mxn(r.total)}. El inventario se actualizó.`);
    await refrescar("compras", "materiaPrima", "stats");
  };

  const valorInventario = materiaPrima.reduce((a, m) => a + m.cantidad * m.precio_unitario, 0);

  const tabs = [
    { id:"solicitudes",  label:"Solicitudes",   icon:ClipboardList },
    { id:"clientes",     label:"Clientes",       icon:Users         },
    { id:"tecnicos",     label:"Técnicos",       icon:User          },
    { id:"proveedores",  label:"Proveedores",    icon:Truck         },
    { id:"inventario",   label:"Materia Prima",  icon:Package       },
    { id:"compras",      label:"Compras",        icon:FileText      },
    { id:"historial",    label:"Historial",      icon:History       },
    { id:"estadisticas", label:"Estadísticas",   icon:BarChart3     },
  ];
  const cerradas = solicitudes.filter((s) => ESTADOS_CERRADOS.includes(s.estado_id));

  return (
    <section className="admin">
      <div className="admin-header">
        <div>
          <span className="eyebrow eyebrow-dark">Panel administrativo</span>
          <h1>Operación del servicio</h1>
          {usuario && <p className="dim" style={{ marginTop:4 }}>Sesión: {usuario.nombre} · {usuario.rol}</p>}
        </div>
        <div className="admin-tabs">
          {tabs.map((t)=>(
            <button key={t.id} className={`admin-tab ${tab===t.id?"is-active":""}`} onClick={()=>setTab(t.id)}><t.icon size={15}/> {t.label}</button>
          ))}
        </div>
      </div>

      {cargando && <p className="dim" style={{ padding:"20px 0" }}>Cargando datos…</p>}

      {/* ── SOLICITUDES ── */}
      {tab==="solicitudes" && (
        <div className="admin-panel">
          <div className="admin-toolbar">
            <div className="input-wrap input-wrap-search"><Search size={15}/><input placeholder="Buscar por folio o cliente" value={search} onChange={(e)=>setSearch(e.target.value)}/></div>
            <select value={filterEstado} onChange={(e)=>setFilter(e.target.value)}><option value="">Todos</option>{cat.estados.map((e)=><option key={e.id} value={e.id}>{e.nombre}</option>)}</select>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Folio</th><th>Cliente</th><th>Servicio</th><th>Inmueble</th><th>Tamaño</th><th>Subtotal</th><th>IVA</th><th>Total</th><th>Fecha</th><th>Técnico</th><th>Estado</th></tr></thead>
              <tbody>
                {filtered.map((s)=>{
                  const cerrada = ESTADOS_CERRADOS.includes(s.estado_id);
                  return (
                    <tr key={s.orden_id}>
                      <td className="mono">{s.folio}</td><td>{s.cliente}</td><td>{s.servicio}</td>
                      <td>{s.inmueble}</td><td>{s.tamano}</td>
                      <td className="mono">{currency(s.subtotal)}</td><td className="mono">{currency(s.iva)}</td><td className="mono">{currency(s.total)}</td>
                      <td>{s.fecha_servicio} <span className="dim">· {s.horario}</span></td>
                      <td>
                        <select className="estado-select" value={s.tecnico_id ?? ""} disabled={cerrada} onChange={(e)=>asignarTecnico(s, e.target.value)} style={{ background:s.tecnico_id?"#EAF7EA":cerrada?"#ECEFF1":"#FFF4E0", color:s.tecnico_id?"#1E5E24":cerrada?"#45605C":"#8A5A00", opacity:cerrada?0.7:1 }}>
                          <option value="">Sin asignar</option>
                          {tecnicos.map((t)=><option key={t.id} value={t.id}>{t.nombre} {t.apellido_paterno}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="estado-select" value={s.estado_id} disabled={cerrada} onChange={(e)=>cambiarEstado(s, e.target.value)} style={{ background:ESTADO_STYLE[s.estado].bg, color:ESTADO_STYLE[s.estado].fg, opacity:cerrada?0.85:1 }}>
                          {cat.estados.map((e)=><option key={e.id} value={e.id}>{e.nombre}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length===0 && <tr><td colSpan={11} className="table-empty">No hay solicitudes con estos filtros.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── CLIENTES ── */}
      {tab==="clientes" && (
        <div className="admin-panel">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>ID</th><th>Nombre</th><th>Ap. Paterno</th><th>Ap. Materno</th><th>Teléfono</th><th>Correo</th><th>Calle</th><th>Núm.</th><th>Colonia</th><th>C.P.</th><th>RFC</th><th>Servicios</th></tr></thead>
              <tbody>
                {clientes.map((c)=>(
                  <tr key={c.id}><td className="mono">C-{c.id}</td><td>{c.nombre}</td><td>{c.apellido_paterno}</td><td>{c.apellido_materno}</td><td>{fmtTel(c.telefono)}</td><td>{c.correo}</td><td>{c.calle}</td><td>{c.numero}</td><td>{c.colonia}</td><td>{c.codigo_postal}</td><td className="mono">{c.rfc||"—"}</td><td><strong>{c.servicios}</strong></td></tr>
                ))}
                {clientes.length===0 && <tr><td colSpan={12} className="table-empty">No hay clientes registrados.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TÉCNICOS ── */}
      {tab==="tecnicos" && (
        <div className="admin-panel">
          <div className="admin-toolbar">
            <button className="btn btn-primary" onClick={()=>setModal({tipo:"tecnico"})}><Plus size={15}/> Agregar técnico</button>
            {esAdmin && <span style={{ marginLeft:"auto" }}><ClearAllBtn count={tecnicos.length} label="técnicos" onClear={vaciarTecnicos}/></span>}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>ID</th><th>Nombre</th><th>Ap. Paterno</th><th>Ap. Materno</th><th>Teléfono</th><th>Correo</th><th>RFC</th><th>NSS</th><th>Zona / Sucursal</th><th>Contacto de emergencia</th><th>Especialidad</th><th>Asignaciones activas</th><th></th></tr></thead>
              <tbody>
                {tecnicos.map((t)=>(
                  <tr key={t.id}>
                    <td className="mono">T-{String(t.id).padStart(2,"0")}</td><td>{t.nombre}</td><td>{t.apellido_paterno}</td><td>{t.apellido_materno}</td>
                    <td>{fmtTel(t.telefono)}</td><td>{t.correo}</td><td className="mono">{t.rfc}</td><td className="mono">{t.nss}</td><td>{t.zona}</td>
                    <td>{t.contacto_emergencia_nombre}<br/><span className="mono" style={{fontSize:12}}>{fmtTel(t.contacto_emergencia_telefono)}</span></td><td>{t.especialidad}</td>
                    <td><strong>{t.asignaciones_activas}</strong></td>
                    <td>{esAdmin && <DeleteBtn onDelete={()=>delTecnico(t.id)} label="técnico"/>}</td>
                  </tr>
                ))}
                {tecnicos.length===0&&<tr><td colSpan={13} className="table-empty">No hay técnicos registrados.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── PROVEEDORES ── */}
      {tab==="proveedores" && (
        <div className="admin-panel">
          <div className="admin-toolbar">
            <button className="btn btn-primary" onClick={()=>setModal({tipo:"proveedor"})}><Plus size={15}/> Agregar proveedor</button>
            {esAdmin && <span style={{ marginLeft:"auto" }}><ClearAllBtn count={proveedores.length} label="proveedores" onClear={vaciarProveedores}/></span>}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>ID</th><th>Nombre</th><th>Teléfono</th><th>Correo</th><th>RFC</th><th>Categoría</th><th>Dirección</th><th></th></tr></thead>
              <tbody>
                {proveedores.map((p)=>(
                  <tr key={p.id}>
                    <td className="mono">PR-{String(p.id).padStart(2,"0")}</td><td>{p.nombre}</td><td>{fmtTel(p.telefono)}</td><td>{p.correo}</td>
                    <td className="mono">{p.rfc}</td><td>{p.categoria_proveedor}</td><td>{p.direccion}</td>
                    <td>{esAdmin && <DeleteBtn onDelete={()=>delProveedor(p.id)} label="proveedor"/>}</td>
                  </tr>
                ))}
                {proveedores.length===0&&<tr><td colSpan={8} className="table-empty">No hay proveedores registrados.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── MATERIA PRIMA ── */}
      {tab==="inventario" && (
        <div className="admin-panel">
          <div className="admin-toolbar">
            <button className="btn btn-primary" onClick={()=>setModal({tipo:"materiaPrima"})}><Plus size={15}/> Agregar insumo</button>
            <span className="dim" style={{ marginLeft:"auto" }}>Valor total en inventario: <strong style={{ color:"var(--ink)" }}>{mxn(valorInventario)}</strong></span>
            {esAdmin && <ClearAllBtn count={materiaPrima.length} label="insumos" onClear={vaciarMateriaPrima}/>}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>ID</th><th>Nombre</th><th>Descripción</th><th>Existencia</th><th>Precio por unidad</th><th>Valor en stock</th><th>Proveedor</th><th></th></tr></thead>
              <tbody>
                {materiaPrima.map((m)=>{
                  const bajo = !!m.bajo_stock;
                  return (
                    <tr key={m.id}>
                      <td className="mono">MP-{String(m.id).padStart(2,"0")}</td><td><strong>{m.nombre}</strong></td><td>{m.descripcion}</td>
                      <td>
                        <span style={{ color:bajo?"#C1473F":"#1E5E24", fontWeight:600 }}>{m.cantidad} {m.unidad}</span>
                        {bajo && <span className="dim" style={{ display:"block", color:"#C1473F" }}>⚠ Bajo stock (mín. {m.stock_minimo} {m.unidad})</span>}
                      </td>
                      <td className="mono">{mxn(m.precio_unitario)} / {m.unidad}</td>
                      <td className="mono">{mxn(m.cantidad*m.precio_unitario)}</td>
                      <td>{m.proveedor ?? "—"}</td>
                      <td>{esAdmin && <DeleteBtn onDelete={()=>delMateriaPrima(m.id)} label="insumo"/>}</td>
                    </tr>
                  );
                })}
                {materiaPrima.length===0&&<tr><td colSpan={8} className="table-empty">No hay insumos registrados.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── COMPRAS ── */}
      {tab==="compras" && (
        <div className="admin-panel">
          <div className="admin-toolbar">
            <button className="btn btn-primary" onClick={()=>setModal({tipo:"compra"})}><Plus size={15}/> Registrar compra</button>
            <span className="dim" style={{ marginLeft:"auto" }}>Cada compra suma sus cantidades al inventario.</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>ID</th><th>Fecha</th><th>Proveedor</th><th>Productos</th><th>Subtotal</th><th>IVA</th><th>Total</th></tr></thead>
              <tbody>
                {compras.map((c)=>(
                  <tr key={c.id}>
                    <td className="mono">CP-{String(c.id).padStart(3,"0")}</td><td>{c.fecha_compra}</td><td>{c.proveedor ?? "—"}</td>
                    <td>{c.detalle.map((d,i)=><div key={i}>{d.insumo} <span className="dim">× {d.cantidad} {d.unidad} a {mxn(d.costo_unitario)}</span></div>)}</td>
                    <td className="mono">{mxn(c.subtotal)}</td><td className="mono">{mxn(c.iva)}</td><td className="mono">{mxn(c.total)}</td>
                  </tr>
                ))}
                {compras.length===0&&<tr><td colSpan={7} className="table-empty">Aún no hay compras registradas.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── HISTORIAL ── */}
      {tab==="historial" && (
        <div className="admin-panel">
          <div className="history-list">
            {cerradas.map((s)=>(
              <div className="history-item" key={s.orden_id}>
                <Badge estado={s.estado}/>
                <div className="history-body"><strong>{s.servicio} · {s.cliente}</strong><span className="dim">{s.folio} — {s.fecha_servicio} · {s.horario} — {s.inmueble} {s.tamano}</span></div>
                <span className="mono" style={{ textDecoration:s.estado==="Cancelado"?"line-through":"none", opacity:s.estado==="Cancelado"?0.55:1 }}>{currency(s.total)}</span>
              </div>
            ))}
            {cerradas.length===0 && <p className="table-empty">Aún no hay servicios completados o cancelados.</p>}
          </div>
        </div>
      )}

      {/* ── ESTADÍSTICAS ── */}
      {tab==="estadisticas" && stats && (
        <div className="admin-panel stats-panel">
          <div className="stat-cards">
            <div className="stat-card"><span>Solicitudes totales</span><strong>{stats.total}</strong></div>
            <div className="stat-card"><span>Pendientes por atender</span><strong>{stats.pendientes}</strong></div>
            <div className="stat-card"><span>Ingresos (completados)</span><strong>{currency(stats.ingresos)}</strong></div>
            <div className="stat-card"><span>Ticket promedio</span><strong>{currency(stats.promedio)}</strong></div>
          </div>
          <div className="chart-block">
            <div className="chart-head"><h3>Servicios agendados por mes</h3><span className="dim">Últimos 6 meses · sin canceladas</span></div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats.por_mes} margin={{ top:8,right:8,left:-18,bottom:0 }}>
                <CartesianGrid vertical={false} stroke="#D7E0DE"/>
                <XAxis dataKey="mes" tick={{ fill:"#45605C",fontSize:12 }} axisLine={{ stroke:"#D7E0DE" }} tickLine={false}/>
                <YAxis allowDecimals={false} tick={{ fill:"#45605C",fontSize:12 }} axisLine={false} tickLine={false}/>
                <Tooltip cursor={{ fill:"#ECEFF1" }} contentStyle={{ borderRadius:8,border:"1px solid #D7E0DE",fontSize:13 }}/>
                <Bar dataKey="servicios" radius={[4,4,0,0]}>{stats.por_mes.map((_,i)=><Cell key={i} fill={i===stats.por_mes.length-1?"#1976D2":"#4DB6AC"}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-block">
            <div className="chart-head"><h3>Solicitudes por tipo de servicio</h3><span className="dim">Acumulado del sistema</span></div>
            <div className="service-bars">
              {stats.por_servicio.map((s)=>(
                <div className="service-bar-row" key={s.id}>
                  <span className="service-bar-label">{s.servicio}</span>
                  <div className="service-bar-track"><div className="service-bar-fill" style={{ width:`${(s.cantidad/Math.max(1,stats.total))*100}%` }}/></div>
                  <span className="service-bar-count">{s.cantidad}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ MODALES ══ */}
      {modal?.tipo==="tecnico"      && <ModalTecnico      onSave={addTecnico}      onClose={()=>setModal(null)} servicios={cat.servicios}/>}
      {modal?.tipo==="proveedor"    && <ModalProveedor    onSave={addProveedor}    onClose={()=>setModal(null)} categorias={cat.categorias_proveedor}/>}
      {modal?.tipo==="materiaPrima" && <ModalMateriaPrima onSave={addMateriaPrima} onClose={()=>setModal(null)} proveedores={proveedores}/>}
      {modal?.tipo==="compra"       && <ModalCompra       onSave={addCompra}       onClose={()=>setModal(null)} proveedores={proveedores} materiaPrima={materiaPrima}/>}
    </section>
  );
}

/* ──────────────────────────────────────────────
   MODALES DE ALTA (envían los datos a la API)
────────────────────────────────────────────── */

/* Estado de un formulario modal: campos, errores por campo y estado de guardado */
function useFormModal(initial) {
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState({});
  const [guardando, setGuardando] = useState(false);
  const up = (k, v) => {
    setF((x) => ({ ...x, [k]:v }));
    setErrors((e) => ((e[k] || e._form) ? { ...e, [k]:undefined, _form:undefined } : e));
  };
  /* Ejecuta el guardado; si el servidor rechaza los datos, muestra sus mensajes en el formulario */
  const guardar = async (accion) => {
    if (guardando) return;
    setGuardando(true);
    try { await accion(); }
    catch (err) { setErrors({ ...(err.campos || {}), _form:err.message }); setGuardando(false); }
  };
  return { f, up, errors, setErrors, guardando, guardar };
}

function ModalTecnico({ onSave, onClose, servicios }) {
  const { f, up, errors, setErrors, guardando, guardar } = useFormModal({ nombre:"", apellido_paterno:"", apellido_materno:"", telefono:"", confirmacionTelefono:"", correo:"", confirmacionCorreo:"", rfc:"", nss:"", zona:"", servicio_id:"", contacto_emergencia_nombre:"", contacto_emergencia_telefono:"" });
  const validate = () => {
    const e = {};
    if (!f.nombre.trim())           e.nombre = "Ingresa el nombre.";
    if (!f.apellido_paterno.trim()) e.apellido_paterno = "Ingresa el apellido paterno.";
    if (soloDigitos(f.telefono).length !== 10) e.telefono = "Ingresa un teléfono de 10 dígitos.";
    if (soloDigitos(f.confirmacionTelefono) !== soloDigitos(f.telefono) || !f.confirmacionTelefono.trim()) e.confirmacionTelefono = "Los teléfonos no coinciden.";
    if (!EMAIL_RE.test(f.correo.trim())) e.correo = "Correo inválido.";
    if (f.correo.trim().toLowerCase() !== f.confirmacionCorreo.trim().toLowerCase() || !f.confirmacionCorreo.trim()) e.confirmacionCorreo = "Los correos no coinciden.";
    if (!/^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/i.test(f.rfc.trim())) e.rfc = "RFC inválido (persona física, 13 caracteres).";
    if (soloDigitos(f.nss).length !== 11) e.nss = "El NSS debe tener 11 dígitos.";
    if (!f.zona)         e.zona = "Selecciona la zona o sucursal.";
    if (!f.servicio_id)  e.servicio_id = "Selecciona una especialidad.";
    if (!f.contacto_emergencia_nombre.trim()) e.contacto_emergencia_nombre = "Ingresa el nombre del contacto de emergencia.";
    if (soloDigitos(f.contacto_emergencia_telefono).length !== 10) e.contacto_emergencia_telefono = "Ingresa un teléfono de 10 dígitos.";
    else if (soloDigitos(f.contacto_emergencia_telefono) === soloDigitos(f.telefono)) e.contacto_emergencia_telefono = "Debe ser distinto al teléfono del técnico.";
    setErrors(e); return Object.keys(e).length === 0;
  };
  const submit = (ev) => {
    ev.preventDefault(); if (!validate()) return;
    guardar(() => onSave({
      nombre:f.nombre.trim(), apellido_paterno:f.apellido_paterno.trim(), apellido_materno:f.apellido_materno.trim(),
      telefono:f.telefono, correo:f.correo.trim(), rfc:f.rfc.trim().toUpperCase(), nss:soloDigitos(f.nss),
      zona:f.zona, servicio_id:Number(f.servicio_id),
      contacto_emergencia_nombre:f.contacto_emergencia_nombre.trim(), contacto_emergencia_telefono:f.contacto_emergencia_telefono,
    }));
  };
  const fp = { form:f, update:up, errors };
  return (
    <Modal title="Agregar técnico" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form-row form-row-3">
          <Field {...fp} label="Nombre(s)*" name="nombre" placeholder="Nombre"/>
          <Field {...fp} label="Ap. Paterno*" name="apellido_paterno" placeholder="Ap. Paterno"/>
          <Field {...fp} label="Ap. Materno (opcional)" name="apellido_materno" placeholder="Ap. Materno"/>
        </div>
        <div className="form-row form-row-2">
          <Field {...fp} label="Teléfono*" name="telefono" type="tel" inputMode="tel" placeholder="81 0000 0000" maxLength={14}/>
          <Field {...fp} label="Confirmación de teléfono*" name="confirmacionTelefono" type="tel" inputMode="tel" placeholder="Repite el teléfono" maxLength={14}/>
        </div>
        <div className="form-row form-row-2">
          <Field {...fp} label="Correo*" name="correo" type="email" placeholder="correo@marronking.mx"/>
          <Field {...fp} label="Confirmación de correo*" name="confirmacionCorreo" type="email" placeholder="Repite el correo"/>
        </div>
        <div className="form-row form-row-2">
          <Field {...fp} label="RFC*" name="rfc" placeholder="RFC" maxLength={13}/>
          <Field {...fp} label="Número de Seguro Social (NSS)*" name="nss" inputMode="numeric" placeholder="11 dígitos" maxLength={11}/>
        </div>
        <div className="form-row form-row-2">
          <label>Zona o sucursal asignada*<div className="input-wrap">
            <select value={f.zona} onChange={(e)=>up("zona",e.target.value)}>
              <option value="">Selecciona</option>
              {ZONAS.map((z)=><option key={z} value={z}>{z}</option>)}
            </select>
          </div>{errors.zona&&<span className="field-error">{errors.zona}</span>}</label>
          <label>Especialidad*<div className="input-wrap">
            <select value={f.servicio_id} onChange={(e)=>up("servicio_id",e.target.value)}>
              <option value="">Selecciona</option>
              {servicios.map((sv)=><option key={sv.id} value={sv.id}>{sv.nombre}</option>)}
            </select>
          </div>{errors.servicio_id&&<span className="field-error">{errors.servicio_id}</span>}</label>
        </div>
        <div className="form-row form-row-2">
          <Field {...fp} label="Contacto de emergencia (nombre)*" name="contacto_emergencia_nombre" placeholder="Nombre completo"/>
          <Field {...fp} label="Contacto de emergencia (teléfono)*" name="contacto_emergencia_telefono" type="tel" inputMode="tel" placeholder="81 0000 0000" maxLength={14}/>
        </div>
        {errors._form && <span className="field-error">{errors._form}</span>}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={guardando}><Plus size={15}/> {guardando ? "Guardando…" : "Guardar técnico"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ModalProveedor({ onSave, onClose, categorias }) {
  const { f, up, errors, setErrors, guardando, guardar } = useFormModal({ nombre:"", telefono:"", confirmacionTelefono:"", correo:"", confirmacionCorreo:"", rfc:"", categoria_proveedor:"", direccion:"" });
  const validate = () => {
    const e = {};
    if (!f.nombre.trim()) e.nombre = "Ingresa la razón social.";
    if (!f.categoria_proveedor) e.categoria_proveedor = "Selecciona una categoría.";
    if (soloDigitos(f.telefono).length !== 10) e.telefono = "Ingresa un teléfono de 10 dígitos.";
    if (soloDigitos(f.confirmacionTelefono) !== soloDigitos(f.telefono) || !f.confirmacionTelefono.trim()) e.confirmacionTelefono = "Los teléfonos no coinciden.";
    if (!EMAIL_RE.test(f.correo.trim())) e.correo = "Correo inválido.";
    if (f.correo.trim().toLowerCase() !== f.confirmacionCorreo.trim().toLowerCase() || !f.confirmacionCorreo.trim()) e.confirmacionCorreo = "Los correos no coinciden.";
    if (!RFC_RE.test(f.rfc.trim())) e.rfc = "RFC inválido.";
    if (!f.direccion.trim()) e.direccion = "Ingresa la dirección.";
    setErrors(e); return Object.keys(e).length === 0;
  };
  const submit = (ev) => {
    ev.preventDefault(); if (!validate()) return;
    guardar(() => onSave({
      nombre:f.nombre.trim(), categoria_proveedor:f.categoria_proveedor, telefono:f.telefono,
      correo:f.correo.trim(), rfc:f.rfc.trim().toUpperCase(), direccion:f.direccion.trim(),
    }));
  };
  const fp = { form:f, update:up, errors };
  return (
    <Modal title="Agregar proveedor" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form-row form-row-2">
          <Field {...fp} label="Nombre*" name="nombre" placeholder="Razón social"/>
          <label>Categoría*<div className="input-wrap">
            <select value={f.categoria_proveedor} onChange={(e)=>up("categoria_proveedor",e.target.value)}>
              <option value="">Selecciona</option>
              {categorias.map((c)=><option key={c}>{c}</option>)}
            </select>
          </div>{errors.categoria_proveedor&&<span className="field-error">{errors.categoria_proveedor}</span>}</label>
        </div>
        <div className="form-row form-row-2">
          <Field {...fp} label="Teléfono*" name="telefono" type="tel" inputMode="tel" placeholder="81 0000 0000" maxLength={14}/>
          <Field {...fp} label="Confirmación de teléfono*" name="confirmacionTelefono" type="tel" inputMode="tel" placeholder="Repite el teléfono" maxLength={14}/>
        </div>
        <div className="form-row form-row-2">
          <Field {...fp} label="Correo*" name="correo" type="email" placeholder="contacto@proveedor.mx"/>
          <Field {...fp} label="Confirmación de correo*" name="confirmacionCorreo" type="email" placeholder="Repite el correo"/>
        </div>
        <Field {...fp} label="RFC*" name="rfc" placeholder="RFC" maxLength={13}/>
        <Field {...fp} label="Dirección*" name="direccion" placeholder="Calle, número, ciudad"/>
        {errors._form && <span className="field-error">{errors._form}</span>}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={guardando}><Plus size={15}/> {guardando ? "Guardando…" : "Guardar proveedor"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ModalMateriaPrima({ onSave, onClose, proveedores }) {
  const { f, up, errors, setErrors, guardando, guardar } = useFormModal({ nombre:"", descripcion:"", cantidad:"", unidad:"L", stock_minimo:"", precio_unitario:"", proveedor_id:"" });
  const validate = () => {
    const e = {};
    if (!f.nombre.trim()) e.nombre = "Ingresa el nombre del insumo.";
    if (f.cantidad === "" || Number(f.cantidad) < 0) e.cantidad = "Cantidad inválida.";
    if (f.precio_unitario === "" || Number(f.precio_unitario) < 0) e.precio_unitario = "Precio inválido.";
    if (f.stock_minimo !== "" && Number(f.stock_minimo) < 0) e.stock_minimo = "Stock mínimo inválido.";
    setErrors(e); return Object.keys(e).length === 0;
  };
  const submit = (ev) => {
    ev.preventDefault(); if (!validate()) return;
    guardar(() => onSave({
      nombre:f.nombre.trim(), descripcion:f.descripcion.trim(), cantidad:Number(f.cantidad), unidad:f.unidad,
      stock_minimo:Number(f.stock_minimo || 0), precio_unitario:Number(f.precio_unitario),
      proveedor_id:f.proveedor_id ? Number(f.proveedor_id) : null,
    }));
  };
  return (
    <Modal title="Agregar insumo / materia prima" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <label>Nombre del insumo*<div className="input-wrap"><input value={f.nombre} onChange={(e)=>up("nombre",e.target.value)} placeholder="Ej. Insecticida Cipermetrina"/></div>{errors.nombre&&<span className="field-error">{errors.nombre}</span>}</label>
        <label>Descripción<div className="input-wrap"><input value={f.descripcion} onChange={(e)=>up("descripcion",e.target.value)} placeholder="Breve descripción del producto"/></div></label>
        <div className="form-row form-row-3">
          <label>Cantidad*<div className="input-wrap"><input type="number" min="0" step="any" value={f.cantidad} onChange={(e)=>up("cantidad",e.target.value)} placeholder="0"/></div>{errors.cantidad&&<span className="field-error">{errors.cantidad}</span>}</label>
          <label>Unidad<div className="input-wrap">
            <select value={f.unidad} onChange={(e)=>up("unidad",e.target.value)}>
              {UNIDADES.map((u)=><option key={u}>{u}</option>)}
            </select>
          </div></label>
          <label>Stock mínimo<div className="input-wrap"><input type="number" min="0" step="any" value={f.stock_minimo} onChange={(e)=>up("stock_minimo",e.target.value)} placeholder="0"/></div>{errors.stock_minimo&&<span className="field-error">{errors.stock_minimo}</span>}</label>
        </div>
        <label>Precio por unidad (MXN)*<div className="input-wrap"><input type="number" min="0" step="0.01" value={f.precio_unitario} onChange={(e)=>up("precio_unitario",e.target.value)} placeholder="0.00"/></div>{errors.precio_unitario&&<span className="field-error">{errors.precio_unitario}</span>}</label>
        <label>Proveedor<div className="input-wrap">
          <select value={f.proveedor_id} onChange={(e)=>up("proveedor_id",e.target.value)}>
            <option value="">Sin proveedor asignado</option>
            {proveedores.map((p)=><option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div></label>
        {errors._form && <span className="field-error">{errors._form}</span>}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={guardando}><Plus size={15}/> {guardando ? "Guardando…" : "Guardar insumo"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ModalCompra({ onSave, onClose, proveedores, materiaPrima }) {
  const [proveedorId, setProveedorId] = useState("");
  const [lineas, setLineas] = useState([{ materia_prima_id:"", cantidad:"", costo_unitario:"" }]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const setLinea = (i, patch) => { setError(""); setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); };
  const elegirInsumo = (i, id) => {
    const m = materiaPrima.find((x) => String(x.id) === String(id));
    setLinea(i, { materia_prima_id:id, costo_unitario: m ? String(m.precio_unitario) : "" });
  };
  const subtotal = lineas.reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0), 0);
  const iva = Math.round(subtotal * IVA_RATE * 100) / 100;
  const submit = async (ev) => {
    ev.preventDefault(); if (guardando) return;
    if (!proveedorId) { setError("Selecciona un proveedor."); return; }
    if (lineas.some((l) => !l.materia_prima_id || !(Number(l.cantidad) > 0) || l.costo_unitario === "" || Number(l.costo_unitario) < 0)) {
      setError("Completa cada línea: insumo, cantidad mayor a 0 y costo."); return;
    }
    setGuardando(true);
    try {
      await onSave({ proveedor_id:Number(proveedorId), items:lineas.map((l) => ({ materia_prima_id:Number(l.materia_prima_id), cantidad:Number(l.cantidad), costo_unitario:Number(l.costo_unitario) })) });
    } catch (err) { setError(err.message); setGuardando(false); }
  };
  const sinDatos = proveedores.length === 0 || materiaPrima.length === 0;
  return (
    <Modal title="Registrar compra a proveedor" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        {sinDatos && <span className="field-error">Primero registra al menos un proveedor y un insumo.</span>}
        <label>Proveedor*<div className="input-wrap">
          <select value={proveedorId} onChange={(e)=>{ setProveedorId(e.target.value); setError(""); }}>
            <option value="">Selecciona</option>
            {proveedores.map((p)=><option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div></label>
        <p className="form-section-title">Productos comprados</p>
        {lineas.map((l, i) => (
          <div className="compra-linea" key={i}>
            <label>Insumo<div className="input-wrap">
              <select value={l.materia_prima_id} onChange={(e)=>elegirInsumo(i, e.target.value)}>
                <option value="">Selecciona</option>
                {materiaPrima.map((m)=><option key={m.id} value={m.id}>{m.nombre} ({m.unidad})</option>)}
              </select>
            </div></label>
            <label>Cantidad<div className="input-wrap"><input type="number" min="0" step="any" value={l.cantidad} onChange={(e)=>setLinea(i,{cantidad:e.target.value})} placeholder="0"/></div></label>
            <label>Costo unitario<div className="input-wrap"><input type="number" min="0" step="0.01" value={l.costo_unitario} onChange={(e)=>setLinea(i,{costo_unitario:e.target.value})} placeholder="0.00"/></div></label>
            <button type="button" className="btn-del" title="Quitar línea" disabled={lineas.length === 1} onClick={()=>setLineas((ls)=>ls.filter((_, j)=>j!==i))}><Trash2 size={14}/></button>
          </div>
        ))}
        <button type="button" className="btn btn-outline" style={{ alignSelf:"flex-start" }} onClick={()=>setLineas((ls)=>[...ls, { materia_prima_id:"", cantidad:"", costo_unitario:"" }])}><Plus size={15}/> Agregar otro producto</button>
        <div className="ticket-row"><span>Subtotal</span><strong>{currency2(subtotal)}</strong></div>
        <div className="ticket-row"><span>IVA (16%)</span><strong>{currency2(iva)}</strong></div>
        <div className="ticket-row ticket-total"><span>Total</span><strong>{currency2(subtotal + iva)}</strong></div>
        {error && <span className="field-error">{error}</span>}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={guardando || sinDatos}><Plus size={15}/> {guardando ? "Guardando…" : "Registrar compra"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ============================================================
   APP RAÍZ
   ============================================================ */

export default function App() {
  const [page,       setPage]      = useState("home");
  const [quote,      setQuote]     = useState({ selections:{ propertyId:null, pestId:null, sizeId:null, serviceId:null }, result:null });
  const [cat,        setCat]       = useState(null);      // catálogo que viene de MySQL
  const [catError,   setCatError]  = useState("");
  const [toastMsg,   setToastMsg]  = useState("");
  const [usuario,    setUsuario]   = useState(null);

  const cargarCatalogo = useCallback(async () => {
    setCatError("");
    try { setCat(await api("/catalogos")); }
    catch (err) { setCatError(err.message); }
  }, []);

  /* Al abrir la página: carga el catálogo y recupera la sesión si ya había iniciado */
  useEffect(() => {
    cargarCatalogo();
    api("/auth/me").then((r) => setUsuario(r.usuario)).catch(() => {});
  }, [cargarCatalogo]);

  const handleLogin  = (u) => { setUsuario(u); setToastMsg(`Bienvenido, ${u.nombre}.`); };
  const handleLogout = async () => {
    try { await api("/auth/logout", { method:"POST" }); } catch { /* si falla, igual se cierra en pantalla */ }
    setUsuario(null); setPage("home"); setToastMsg("Sesión cerrada.");
  };
  const sesionExpirada = useCallback(() => { setUsuario(null); setPage("login"); setToastMsg("Tu sesión expiró. Inicia sesión de nuevo."); }, []);
  const closeToast = useCallback(() => setToastMsg(""), []);

  useEffect(() => { window.scrollTo({ top:0 }); }, [page]);

  const gate = (hijo) => <CatalogGate cat={cat} error={catError} onRetry={cargarCatalogo}>{hijo}</CatalogGate>;

  return (
    <div className="mk-app">
      <style>{CSS}</style>
      <Nav page={page} setPage={setPage} usuario={usuario} onLogout={handleLogout}/>

      {page==="home"      && <HomePage  setPage={setPage}/>}
      {page==="login"     && <LoginPage setPage={setPage} onLogin={handleLogin}/>}
      {page==="cotizador" && gate(<CotizadorPage cat={cat} quote={quote} setQuote={setQuote} setPage={setPage} setToast={setToastMsg}/>)}
      {page==="solicitud" && gate(<SolicitudPage cat={cat} quote={quote} setPage={setPage} setToast={setToastMsg}/>)}
      {page==="catalogo"  && gate(<CatalogoPage cat={cat} setPage={setPage} setQuote={setQuote}/>)}
      {page==="admin"     && (
        usuario
          ? gate(<AdminPage cat={cat} usuario={usuario} setToast={setToastMsg} onSesionExpirada={sesionExpirada}/>)
          : <LoginPage setPage={setPage} onLogin={handleLogin}/>
      )}

      <Footer setPage={setPage}/>
      <Toast message={toastMsg} onClose={closeToast}/>
    </div>
  );
}

/* ============================================================
   ESTILOS
   ============================================================ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');

html, body { margin:0!important; padding:0!important; min-width:0!important; }
body { display:block!important; place-items:unset!important; }
#root { max-width:none!important; width:100%!important; margin:0!important; padding:0!important; text-align:left!important; display:block!important; }

.mk-app {
  --teal-dark: #00695C; --teal-darker: #004339; --teal-light: #4DB6AC;
  --blue: #1976D2; --blue-dark: #12599f;
  --white: #FFFFFF; --grey-blue: #ECEFF1; --ink: #0B2320; --ink-soft: #4b6864; --line: #D7E0DE;
  font-family: 'Inter', sans-serif; color: var(--ink); background: var(--white);
  line-height: 1.5; -webkit-font-smoothing: antialiased;
}
.mk-app * { box-sizing: border-box; }
.mk-app h1, .mk-app h2, .mk-app h3 { font-family: 'Space Grotesk', sans-serif; margin: 0; color: var(--ink); letter-spacing: -0.01em; }
:where(.mk-app) p { margin: 0; color: var(--ink-soft); }
.mk-app button { font-family: inherit; cursor: pointer; }
.mk-app input, .mk-app select, .mk-app textarea { font-family: inherit; }
.mono, .mk-app .mono { font-family: 'IBM Plex Mono', monospace; }

/* Botones */
.btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:11px 20px; border-radius:3px; font-weight:600; font-size:14.5px; border:1px solid transparent; transition:transform .12s ease,background .15s ease,border-color .15s ease; white-space:nowrap; }
.btn:active { transform:translateY(1px); }
.btn:disabled { opacity:.45; cursor:not-allowed; }
.btn-lg { padding:13px 24px; font-size:15.5px; }
.btn-accent { background:var(--blue); color:#fff; }
.btn-accent:hover:not(:disabled) { background:var(--blue-dark); }
.btn-primary { background:var(--teal-dark); color:#fff; }
.btn-primary:hover:not(:disabled) { background:var(--teal-darker); }
.btn-outline { background:transparent; color:var(--teal-dark); border-color:var(--line); }
.btn-outline:hover:not(:disabled) { border-color:var(--teal-dark); background:var(--grey-blue); }
.btn-ghost-inv { background:transparent; color:#fff; border-color:rgba(255,255,255,.4); }
.btn-ghost-inv:hover { border-color:#fff; background:rgba(255,255,255,.08); }

/* Botones eliminar inline */
.btn-del { display:inline-flex; align-items:center; background:transparent; border:1.5px solid #fca5a5; color:#dc2626; border-radius:4px; padding:5px 8px; transition:background .12s; }
.btn-del:hover { background:#fef2f2; }
.btn-del-confirm { background:#dc2626; color:#fff; border:none; border-radius:4px; padding:5px 10px; font-size:12px; font-weight:600; cursor:pointer; }
.btn-del-cancel  { background:transparent; color:var(--ink-soft); border:1px solid var(--line); border-radius:4px; padding:5px 10px; font-size:12px; cursor:pointer; }
.btn-clear { color:#dc2626; border-color:#fca5a5; }
.btn-clear:hover:not(:disabled) { background:#fef2f2; border-color:#dc2626; }

/* Layout */
.section { max-width:1180px; margin:0 auto; padding:76px 28px; }
.section-tint { background:var(--grey-blue); max-width:none; }
.section-tint > * { max-width:1180px; margin-left:auto; margin-right:auto; }
.section-head { max-width:620px; margin-bottom:40px; }
.eyebrow { display:inline-flex; align-items:center; gap:8px; font-family:'IBM Plex Mono',monospace; font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:rgba(255,255,255,.92); margin-bottom:14px; }
.eyebrow::before { content:""; width:16px; height:2px; background:var(--blue); display:inline-block; }
.eyebrow-dark { color:var(--teal-dark); }
.eyebrow-dark::before { background:var(--blue); }
.section-head h2 { font-size:30px; margin-bottom:10px; }
.section-head p { font-size:15.5px; }

/* Nav */
.nav { position:sticky; top:0; z-index:40; background:var(--teal-darker); box-shadow:0 2px 10px rgba(0,20,17,.28); border-bottom:1px solid rgba(0,0,0,.15); }
.nav-inner { max-width:1240px; margin:0 auto; padding:14px 24px; display:flex; align-items:center; justify-content:space-between; gap:20px; }
.brand { display:flex; align-items:center; gap:10px; background:none; border:none; padding:0; }
.brand-mark { display:flex; }
.brand-text { display:flex; flex-direction:column; text-align:left; line-height:1.15; }
.brand-text strong { font-family:'Space Grotesk',sans-serif; color:#fff; font-size:15px; letter-spacing:.01em; }
.brand-text em { font-style:normal; color:rgba(255,255,255,.65); font-size:11px; letter-spacing:.04em; }
.nav-links { display:flex; gap:4px; }
.nav-link { background:none; border:none; color:rgba(255,255,255,.78); padding:8px 14px; border-radius:3px; font-size:14px; font-weight:500; }
.nav-link:hover { color:#fff; background:rgba(255,255,255,.08); }
.nav-link.is-active { color:#fff; background:rgba(255,255,255,.14); }
.nav-actions { display:flex; align-items:center; gap:10px; }
.nav-admin { padding:9px 14px; font-size:13.5px; }
.nav-user-label { font-size:12.5px; color:rgba(255,255,255,.8); display:flex; align-items:center; gap:6px; }
.nav-user-label em { font-style:normal; color:var(--teal-light); }
.nav-burger { display:none; background:none; border:none; color:#fff; }
.nav-mobile { display:none; }
@media (max-width:960px) {
  .nav-links,.nav-cta,.nav-admin,.nav-user-label { display:none; }
  .nav-burger { display:inline-flex; }
  .nav-mobile { display:flex; flex-direction:column; padding:8px 20px 20px; gap:2px; background:#002d26; }
  .nav-mobile-link { display:flex; align-items:center; justify-content:space-between; background:none; border:none; color:#fff; padding:12px 4px; border-bottom:1px solid rgba(255,255,255,.12); font-size:15px; text-align:left; }
}

/* ---------- hero ---------- */
.hero { position: relative; background: linear-gradient(100deg, #00695C 0%, #045d51 26%, #14806f 44%, #5eae9f 64%, #d3ece7 86%, #ffffff 100%); overflow: hidden; }
.hero-mesh { position: absolute; inset: 0; z-index: 0; -webkit-mask-image: linear-gradient(100deg, black 0%, black 34%, transparent 54%); mask-image: linear-gradient(100deg, black 0%, black 34%, transparent 54%); }
.hero-photo { position: absolute; inset: 0; z-index: 0; background-size: cover; background-position: 74% 30%; -webkit-mask-image: linear-gradient(100deg, transparent 0%, transparent 40%, rgba(0,0,0,0.5) 56%, black 74%, black 100%); mask-image: linear-gradient(100deg, transparent 0%, transparent 40%, rgba(0,0,0,0.5) 56%, black 74%, black 100%); }
.hero-photo-tint { position: absolute; inset: 0; z-index: 0; background: linear-gradient(100deg, rgba(0,105,92,0.95) 0%, rgba(0,105,92,0.6) 32%, rgba(0,105,92,0.22) 50%, rgba(0,105,92,0) 68%, rgba(255,255,255,0.1) 100%); }
.hero-inner { position: relative; z-index: 1; max-width: 1180px; margin: 0 auto; padding: 76px 28px 90px; display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 50px; align-items: center; }
.hero-copy h1 { color: #fff; font-size: 44px; line-height: 1.08; margin-bottom: 18px; text-shadow: 0 2px 18px rgba(0,30,26,0.22); }
.hero-lead { color: rgba(255,255,255,0.8); font-size: 16.5px; max-width: 480px; margin-bottom: 30px; }
.hero-actions { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 40px; }
.hero-stats { display: flex; gap: 32px; flex-wrap: wrap; }
.hero-stats div { display: flex; flex-direction: column; }
.hero-stats strong { font-family: 'Space Grotesk', sans-serif; color: #fff; font-size: 20px; }
.hero-stats span { color: rgba(255,255,255,0.6); font-size: 12.5px; }
.hero-visual { display: flex; justify-content: center; }
.hero-ticket { transform: rotate(-2.5deg); }

@media (max-width: 900px) {
  .hero-inner { grid-template-columns: 1fr; }
  .hero-copy h1 { font-size: 32px; }
  .hero-visual { order: -1; }
  .hero-ticket { transform: none; margin-bottom: 10px; }
  .hero { background: linear-gradient(190deg, #ffffff 0%, #d3ece7 20%, #5eae9f 42%, #14806f 62%, #045d51 82%, #00695C 100%); }
  .hero-mesh { -webkit-mask-image: linear-gradient(190deg, transparent 0%, transparent 46%, black 66%, black 100%); mask-image: linear-gradient(190deg, transparent 0%, transparent 46%, black 66%, black 100%); }
  .hero-photo { background-position: 62% 25%; -webkit-mask-image: linear-gradient(190deg, black 0%, black 26%, rgba(0,0,0,0.5) 44%, transparent 60%, transparent 100%); mask-image: linear-gradient(190deg, black 0%, black 26%, rgba(0,0,0,0.5) 44%, transparent 60%, transparent 100%); }
  .hero-photo-tint { background: linear-gradient(190deg, rgba(255,255,255,0.1) 0%, rgba(0,105,92,0) 32%, rgba(0,105,92,0.22) 50%, rgba(0,105,92,0.6) 68%, rgba(0,105,92,0.95) 100%); }
}

/* Ticket */
.ticket { position:relative; width:330px; max-width:100%; background:#fff; border:1px solid var(--line); border-radius:8px; padding:22px 22px 18px; box-shadow:0 18px 40px -18px rgba(0,40,35,.35); }
.ticket-notch { position:absolute; top:50%; width:20px; height:20px; background:var(--grey-blue); border-radius:50%; transform:translateY(-50%); }
.hero .ticket-notch { background:rgba(0,67,57,.8); }
.ticket-notch-left { left:-10px; }
.ticket-notch-right { right:-10px; }
.ticket-head { display:flex; align-items:center; justify-content:space-between; font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.06em; color:var(--teal-dark); margin-bottom:12px; }
.ticket-folio { font-family:'IBM Plex Mono',monospace; font-size:19px; font-weight:600; color:var(--ink); letter-spacing:.03em; margin-bottom:14px; }
.ticket-row { display:flex; justify-content:space-between; gap:12px; font-size:13.5px; padding:5px 0; }
.ticket-row span { color:var(--ink-soft); }
.ticket-row strong { text-align:right; font-weight:600; }
.ticket-divider { border-top:1px dashed var(--line); margin:10px 0; }
.ticket-total strong { color:var(--blue); font-family:'IBM Plex Mono',monospace; font-size:16px; }
.ticket-note { font-size:11.5px; color:var(--ink-soft); margin-top:12px; }

/* Problemática */
.problem-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:14px; }
.problem-card { border:1px solid var(--line); border-radius:6px; padding:20px 16px; background:#fff; color:var(--teal-dark); }
.problem-card h3 { font-size:14.5px; margin:12px 0 6px; }
.problem-card p { font-size:12.5px; }
@media (max-width:980px) { .problem-grid { grid-template-columns:repeat(2,1fr); } }
@media (max-width:560px) { .problem-grid { grid-template-columns:1fr; } }

/* Pasos */
.steps-row { display:flex; align-items:flex-start; gap:0; }
.step-item { flex:1; min-width:0; }
.step-num { font-family:'IBM Plex Mono',monospace; font-size:13px; color:var(--blue); display:block; margin-bottom:10px; }
.step-item h3 { font-size:15.5px; margin-bottom:6px; }
.step-item p { font-size:12.5px; }
.step-connector { flex:0 0 24px; height:1px; background:var(--line); margin-top:8px; }
@media (max-width:900px) { .steps-row { flex-direction:column; gap:20px; } .step-connector { display:none; } }

/* CTA */
.cta-band { position:relative; background:var(--teal-dark); border-radius:10px; overflow:hidden; }
.cta-mesh { position:absolute; inset:0; }
.cta-band-inner { position:relative; z-index:1; display:flex; align-items:center; justify-content:space-between; gap:24px; padding:40px; flex-wrap:wrap; }
.cta-band-inner h2 { color:#fff; font-size:24px; margin-bottom:6px; }
.cta-band-inner p { color:rgba(255,255,255,.75); font-size:14.5px; }

/* Footer */
.footer { background:var(--ink); }
.footer-inner { max-width:1180px; margin:0 auto; padding:50px 28px 30px; display:grid; grid-template-columns:1.4fr 1fr 1fr; gap:30px; }
.footer-copy { color:rgba(255,255,255,.55); font-size:13px; margin-top:12px; max-width:300px; }
.footer-col { display:flex; flex-direction:column; gap:10px; }
.footer-title { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--teal-light); margin-bottom:4px; }
.footer-col button { background:none; border:none; color:rgba(255,255,255,.7); text-align:left; padding:0; font-size:13.5px; }
.footer-col button:hover { color:#fff; }
.footer-col span { display:flex; align-items:center; gap:8px; color:rgba(255,255,255,.7); font-size:13.5px; }
.footer-bottom { border-top:1px solid rgba(255,255,255,.1); padding:16px 28px; text-align:center; color:rgba(255,255,255,.4); font-size:12px; }
@media (max-width:760px) { .footer-inner { grid-template-columns:1fr; } }

/* Login */
.login-wrap { display:flex; justify-content:center; align-items:flex-start; padding-top:60px; }
.login-card { width:100%; max-width:440px; border:1px solid var(--line); border-radius:10px; padding:40px; background:#fff; box-shadow:0 12px 40px -16px rgba(0,40,35,.2); }
.login-head { text-align:center; margin-bottom:28px; }
.login-head svg { color:var(--teal-dark); margin-bottom:12px; }
.login-head h1 { font-size:24px; margin-bottom:8px; }
.login-hint { text-align:center; font-size:12px; margin-top:18px; color:var(--ink-soft); }
.login-hint code { background:var(--grey-blue); padding:2px 5px; border-radius:3px; font-size:11.5px; }

/* Cotizador */
.quoter-header { max-width:560px; margin-bottom:36px; }
.quoter-header h1 { font-size:30px; margin-bottom:8px; }
.stepper { display:flex; align-items:center; margin-bottom:40px; overflow-x:auto; padding-bottom:4px; }
.stepper-item { display:flex; align-items:center; gap:8px; background:none; border:none; padding:4px 2px; white-space:nowrap; }
.stepper-dot { width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:'IBM Plex Mono',monospace; font-size:12px; border:1.5px solid var(--line); color:var(--ink-soft); }
.stepper-current .stepper-dot { border-color:var(--blue); color:var(--blue); background:#E8F1FC; }
.stepper-done .stepper-dot { border-color:var(--teal-dark); background:var(--teal-dark); color:#fff; }
.stepper-label { font-size:13px; color:var(--ink-soft); }
.stepper-current .stepper-label { color:var(--ink); font-weight:600; }
.stepper-line { width:26px; height:1px; background:var(--line); margin:0 6px; flex-shrink:0; }
.option-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; }
.option-grid-pest { grid-template-columns:repeat(2,1fr); }
.option-card { position:relative; display:flex; align-items:center; gap:14px; text-align:left; padding:16px 44px 16px 16px; border:1.5px solid var(--line); border-radius:6px; background:#fff; color:var(--teal-dark); transition:border-color .12s ease,background .12s ease; }
.option-card:hover { border-color:var(--teal-light); }
.option-card.is-selected { border-color:var(--teal-dark); background:#EEF7F5; }
.option-card strong { display:block; font-size:14.5px; color:var(--ink); }
.option-card span { font-size:12.5px; color:var(--ink-soft); }
.option-card-wide { grid-column:span 2; }
.option-check { position:absolute; right:14px; top:50%; transform:translateY(-50%); color:var(--blue); }
.pest-glyph { width:44px; height:44px; border-radius:50%; background:#E4F3F0; display:flex; align-items:center; justify-content:center; flex-shrink:0; color:var(--teal-dark); }
.pest-glyph-lg { width:58px; height:58px; background:#E4F3F0; }
.size-tag,.service-code { font-family:'IBM Plex Mono',monospace; font-size:12px; font-weight:600; color:var(--blue); border:1px solid var(--line); border-radius:4px; padding:4px 8px; flex-shrink:0; }
@media (max-width:700px) { .option-grid { grid-template-columns:1fr; } .option-card-wide { grid-column:span 1; } }
.quoter-body { min-height:220px; margin-bottom:30px; }
.quoter-nav { display:flex; justify-content:space-between; border-top:1px solid var(--line); padding-top:24px; }
.result-wrap { display:grid; grid-template-columns:.9fr 1.1fr; gap:40px; align-items:start; }
.result-ticket { width:100%; }
.result-side h3 { font-size:17px; margin-bottom:14px; }
.result-list { list-style:none; padding:0; margin:0 0 22px; display:flex; flex-direction:column; gap:10px; }
.result-list li { display:flex; align-items:center; gap:10px; color:var(--ink-soft); font-size:14px; }
.result-list svg { color:var(--teal-light); flex-shrink:0; }
@media (max-width:820px) { .result-wrap { grid-template-columns:1fr; } }

/* Solicitud */
.solicitud-wrap { display:grid; grid-template-columns:1.3fr .9fr; gap:46px; align-items:start; }
.solicitud-form-col h1 { font-size:27px; margin:6px 0 8px; }
.solicitud-form-col > p { margin-bottom:26px; font-size:14.5px; }
.form { display:flex; flex-direction:column; gap:16px; }
.form-section-title { font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.07em; text-transform:uppercase; color:var(--teal-dark); border-bottom:1px solid var(--line); padding-bottom:8px; margin-top:8px; }
.form-row-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.form-row-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; }
.form label { display:flex; flex-direction:column; gap:6px; font-size:13px; font-weight:600; color:var(--ink); }
.input-wrap { display:flex; align-items:center; gap:8px; border:1.5px solid var(--line); border-radius:5px; padding:10px 12px; color:var(--ink-soft); background:#fff; }
.input-wrap:focus-within { border-color:var(--teal-dark); }
.input-wrap input,.input-wrap select { border:none; outline:none; width:100%; font-size:14px; color:var(--ink); background:transparent; }
.form textarea { border:1.5px solid var(--line); border-radius:5px; padding:10px 12px; font-size:14px; color:var(--ink); background:#fff; resize:vertical; }
.form textarea:focus { outline:none; border-color:var(--teal-dark); }
.field-error { color:#C1473F; font-size:12px; font-weight:500; }
.summary-ticket { width:100%; position:sticky; top:90px; }
@media (max-width:900px) { .solicitud-wrap { grid-template-columns:1fr; } .form-row-2,.form-row-3 { grid-template-columns:1fr; } .summary-ticket { position:static; } }
.confirm-wrap { max-width:520px; text-align:center; display:flex; flex-direction:column; align-items:center; }
.confirm-head svg { color:var(--teal-dark); margin-bottom:10px; }
.confirm-head h1 { font-size:26px; margin-bottom:8px; }
.confirm-head p { margin-bottom:30px; }
.confirm-ticket { width:100%; text-align:left; margin-bottom:26px; }
.confirm-actions { display:flex; gap:12px; flex-wrap:wrap; justify-content:center; }
.envio-status { margin-bottom:18px; font-size:13px; }
.envio-status span { display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap; justify-content:center; color:var(--ink-soft); }
.envio-enviado span { color:#1E5E24; font-weight:600; }
.envio-pendiente span { color:#8A5A00; }
.compra-linea { display:grid; grid-template-columns:2fr 1fr 1fr auto; gap:10px; align-items:end; }
.compra-linea .btn-del { margin-bottom:6px; }
.btn-del:disabled { opacity:.35; cursor:not-allowed; }
.envio-status a { color:var(--blue); font-weight:600; text-decoration:underline; }
.empty-state { max-width:420px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:10px; }
.empty-state svg { color:var(--teal-light); }
.empty-state h2 { font-size:20px; }
.empty-state .btn { margin-top:10px; }

/* Catálogo */
.catalog-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14px; }
.pest-card { border:1px solid var(--line); border-radius:8px; background:#fff; overflow:hidden; }
.pest-card.is-open { border-color:var(--teal-light); }
.pest-card-head { width:100%; display:flex; align-items:center; gap:16px; padding:18px; background:none; border:none; text-align:left; }
.pest-card-head h3 { font-size:16px; margin-bottom:4px; }
.pest-service-tag { font-size:12px; color:var(--teal-dark); font-weight:600; }
.pest-chevron { margin-left:auto; color:var(--ink-soft); transition:transform .15s ease; flex-shrink:0; }
.pest-chevron.is-rot { transform:rotate(90deg); }
.pest-card-body { padding:0 18px 20px 78px; }
.pest-body-label { font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-soft); font-weight:600; }
.pest-card-body ul { list-style:none; padding:0; margin:10px 0 16px; display:flex; flex-direction:column; gap:7px; }
.pest-card-body li { display:flex; align-items:flex-start; gap:8px; font-size:13.5px; color:var(--ink-soft); }
.pest-card-body li svg { color:var(--teal-light); margin-top:4px; flex-shrink:0; }
@media (max-width:760px) { .catalog-grid { grid-template-columns:1fr; } .pest-card-body { padding-left:18px; } }

/* Admin */
.admin { max-width:1400px; margin:0 auto; padding:50px 28px 90px; }
.admin-header { display:flex; align-items:flex-end; justify-content:space-between; flex-wrap:wrap; gap:20px; margin-bottom:30px; border-bottom:1px solid var(--line); padding-bottom:20px; }
.admin-header h1 { font-size:26px; margin-top:4px; }
.admin-tabs { display:flex; gap:4px; background:var(--grey-blue); padding:4px; border-radius:6px; flex-wrap:wrap; }
.admin-tab { display:flex; align-items:center; gap:6px; background:none; border:none; padding:8px 14px; border-radius:4px; font-size:13.5px; font-weight:500; color:var(--ink-soft); }
.admin-tab.is-active { background:#fff; color:var(--teal-dark); box-shadow:0 1px 2px rgba(0,0,0,.08); }
.admin-toolbar { display:flex; gap:12px; margin-bottom:18px; flex-wrap:wrap; align-items:center; }
.input-wrap-search { max-width:280px; }
.admin-toolbar select { border:1.5px solid var(--line); border-radius:5px; padding:10px 12px; font-size:13.5px; color:var(--ink); background:#fff; }
.table-wrap { overflow-x:auto; border:1px solid var(--line); border-radius:8px; }
.table { width:100%; border-collapse:collapse; font-size:13.5px; min-width:760px; }
.table thead th { text-align:left; background:var(--grey-blue); color:var(--teal-dark); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.03em; padding:12px 14px; }
.table tbody td { padding:13px 14px; border-top:1px solid var(--line); color:var(--ink); }
.table tbody tr:hover { background:#FAFCFC; }
.table-empty { text-align:center; color:var(--ink-soft); padding:30px!important; }
.dim { color:var(--ink-soft); font-size:12px; }
.estado-select { border:none; border-radius:20px; padding:6px 10px; font-size:12.5px; font-weight:600; }
.estado-select:disabled { cursor:not-allowed; }
.badge { display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:20px; font-size:12px; font-weight:600; }
.badge-dot { width:6px; height:6px; border-radius:50%; }
.history-list { display:flex; flex-direction:column; gap:10px; }
.history-item { display:flex; align-items:center; gap:16px; padding:14px 16px; border:1px solid var(--line); border-radius:6px; background:#fff; }
.history-body { display:flex; flex-direction:column; gap:3px; flex:1; }
.history-body strong { font-size:14px; }
.stats-panel { display:flex; flex-direction:column; gap:24px; }
.stat-cards { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
.stat-card { border:1px solid var(--line); border-radius:8px; padding:18px; background:#fff; }
.stat-card span { display:block; font-size:12.5px; color:var(--ink-soft); margin-bottom:8px; }
.stat-card strong { font-family:'Space Grotesk',sans-serif; font-size:22px; color:var(--teal-dark); }
@media (max-width:800px) { .stat-cards { grid-template-columns:repeat(2,1fr); } }
.chart-block { border:1px solid var(--line); border-radius:8px; padding:20px; background:#fff; }
.chart-head { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:12px; }
.chart-head h3 { font-size:15px; }
.service-bars { display:flex; flex-direction:column; gap:12px; }
.service-bar-row { display:grid; grid-template-columns:200px 1fr 24px; align-items:center; gap:12px; }
.service-bar-label { font-size:13px; color:var(--ink-soft); }
.service-bar-track { height:8px; background:var(--grey-blue); border-radius:4px; overflow:hidden; }
.service-bar-fill { height:100%; background:var(--teal-light); border-radius:4px; }
.service-bar-count { font-family:'IBM Plex Mono',monospace; font-size:12.5px; text-align:right; color:var(--ink); }
@media (max-width:620px) { .service-bar-row { grid-template-columns:100px 1fr 20px; } .service-bar-label { font-size:11.5px; } }

/* Modal */
.modal-overlay { position:fixed; inset:0; background:rgba(11,35,32,.55); backdrop-filter:blur(3px); z-index:200; display:flex; align-items:center; justify-content:center; padding:20px; }
.modal-box { background:#fff; border-radius:10px; width:100%; max-width:580px; max-height:90vh; overflow-y:auto; box-shadow:0 24px 60px -16px rgba(0,0,0,.4); }
.modal-head { display:flex; align-items:center; justify-content:space-between; padding:20px 24px; border-bottom:1px solid var(--line); }
.modal-head h3 { font-size:17px; }
.modal-close { background:none; border:none; color:var(--ink-soft); padding:4px; border-radius:4px; display:flex; }
.modal-close:hover { background:var(--grey-blue); }
.modal-body { padding:24px; }
.modal-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:8px; padding-top:16px; border-top:1px solid var(--line); }

/* Toast */
.toast { position:fixed; left:50%; bottom:26px; transform:translateX(-50%); background:var(--ink); color:#fff; display:flex; align-items:center; gap:10px; padding:12px 18px; border-radius:6px; font-size:13.5px; box-shadow:0 12px 30px -10px rgba(0,0,0,.4); z-index:300; max-width:90vw; }
.toast svg { color:var(--teal-light); flex-shrink:0; }
`;
