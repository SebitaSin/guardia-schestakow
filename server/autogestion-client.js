(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var STEPS = ["dni", "datos", "listo"];
  var state = { token: null, found: false, mode: "", seguro: "", dispuesto: "", lugares: "1", necesita: "" };
  var ERRORS = {
    dni: "Revisá el DNI: van sólo los números, sin puntos.",
    clave: "Esos 4 números no coinciden con el celular que tenemos. Probá de nuevo o cargá tus datos de nuevo.",
    limite: "Hubo demasiados intentos. Esperá un rato y volvé a probar.",
    sesion: "Pasó mucho tiempo. Empecemos de nuevo con tu DNI.",
    direccion: "Escribí tu domicilio: calle y número, o barrio y distrito.",
    telefono: "Revisá el celular: con característica, sólo números.",
    transporte: "Elegí cómo venís al hospital.",
    nombre: "Escribí tu apellido y nombre.",
    servicio: "Escribí el servicio donde trabajás.",
    rol: "Escribí tu cargo o función.",
    ayuda: "Marcá dónde podrías ayudar, o que preferís quedarte en tu servicio.",
    falta: "Te falta responder una pregunta de arriba."
  };

  function show(step) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-step]"), function (el) { el.hidden = el.getAttribute("data-step") !== step; });
    Array.prototype.forEach.call(document.querySelectorAll(".dots i"), function (el, index) { el.className = index <= STEPS.indexOf(step) ? "on" : ""; });
    fail("");
    window.scrollTo(0, 0);
  }
  function fail(code) {
    var box = $("err");
    box.hidden = !code;
    box.textContent = code ? (ERRORS[code] || "No se pudo completar. Probá de nuevo en un momento.") : "";
    if (code) box.scrollIntoView({ block: "nearest" });
    if (code === "sesion") setTimeout(function () { show("dni"); }, 1800);
  }
  function api(path, body) {
    return fetch("/api/autogestion/publico/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (response) { return response.json().catch(function () { return { error: "servicio" }; }).then(function (data) { if (!response.ok) throw new Error(data.error || "servicio"); return data; }); });
  }
  function busy(form, on) { var button = form.querySelector("button[type=submit]"); if (button) button.disabled = on; }
  function pick(group, value) {
    state[group] = value;
    if (value) fail("");
    Array.prototype.forEach.call(document.querySelectorAll('[data-group="' + group + '"] button'), function (button) { button.setAttribute("aria-pressed", String(button.getAttribute("data-value") === value)); });
    questions();
  }
  function questions() {
    var car = state.mode === "CAR";
    var safe = car && state.seguro === "si";
    $("q-seguro").hidden = !car;
    $("q-dispuesto").hidden = !safe;
    $("q-lugares").hidden = !(safe && state.dispuesto === "si");
    $("q-necesita").hidden = !state.mode || safe || (car && !state.seguro);
  }
  var ayuda = {};
  function paintAyuda() {
    Array.prototype.forEach.call(document.querySelectorAll("#ayuda button"), function (button) { button.setAttribute("aria-pressed", String(Boolean(ayuda[button.getAttribute("data-value")]))); });
  }
  Array.prototype.forEach.call(document.querySelectorAll("#ayuda button"), function (button) {
    button.addEventListener("click", function () {
      var key = button.getAttribute("data-value");
      if (key === "ninguno") ayuda = ayuda.ninguno ? {} : { ninguno: true };
      else { delete ayuda.ninguno; if (ayuda[key]) delete ayuda[key]; else ayuda[key] = true; }
      paintAyuda();
      fail("");
    });
  });
  function openForm(data) {
    $("nueva").hidden = state.found;
    $("datos-t").textContent = data ? "Revisá tus datos" : "Cargá tus datos";
    $("datos-p").textContent = data ? "Esto es lo que tenemos. Corregí lo que haya cambiado." : "Completá los tres datos y listo.";
    if (!data && state.found && state.nombre) $("datos-p").textContent = "Ficha de " + state.nombre.replace(/\.$/, "") + ". Completá tus datos y listo.";
    $("address").value = data ? data.address : "";
    $("phone").value = data ? data.phone : "";
    $("servicio").value = state.servicio || "";
    $("rol").value = data && data.rol ? data.rol : "";
    ayuda = {};
    if (data && data.ayuda) { if (data.ayuda.length) data.ayuda.forEach(function (key) { ayuda[key] = true; }); else ayuda.ninguno = true; }
    paintAyuda();
    ["mode", "seguro", "dispuesto", "necesita"].forEach(function (group) { pick(group, ""); });
    pick("lugares", "1");
    if (data && data.transportMode) pick("mode", data.transportMode);
    if (data && data.solidario) {
      if (state.mode === "CAR") pick("seguro", data.solidario.vehiculoSeguro ? "si" : "no");
      if (data.solidario.vehiculoSeguro) { pick("dispuesto", data.solidario.dispuesto ? "si" : "no"); if (data.solidario.dispuesto) pick("lugares", String(data.solidario.lugares || 1)); }
      else pick("necesita", data.solidario.necesitaTraslado ? "si" : "no");
    }
    show("datos");
  }

  $("f-dni").addEventListener("submit", function (event) {
    event.preventDefault();
    var form = this;
    busy(form, true);
    api("buscar", { dni: $("dni").value }).then(function (data) {
      state.token = data.token;
      state.found = data.encontrado;
      state.servicio = data.servicioActual || "";
      $("servicios").innerHTML = "";
      (data.servicios || []).forEach(function (name) { var option = document.createElement("option"); option.value = name; $("servicios").appendChild(option); });
      if (!data.encontrado) return openForm(null);
      $("who-n").textContent = data.nombre;
      $("who-s").textContent = data.servicio;
      $("who-i").textContent = (data.nombre || "?").charAt(0);
      $("ya").hidden = !data.yaRespondio;
      if (data.yaRespondio) $("ya").textContent = "Ya respondiste el " + new Date(data.yaRespondio).toLocaleDateString("es-AR") + ". Si volvés a guardar, se reemplaza: no se duplica.";
      $("ult4").value = "";
      // Sin paso de los 4 números del celular (pedido de Sebastián, 7/10/2026): DNI y directo a cargar.
      // Lo que cambie respecto de la nómina sigue quedando "a revisar" si el teléfono escrito no coincide.
      state.nombre = data.nombre || "";
      return openForm(null);
    }).catch(function (error) { fail(error.message); }).then(function () { busy(form, false); });
  });

  $("f-clave").addEventListener("submit", function (event) {
    event.preventDefault();
    var form = this;
    busy(form, true);
    api("verificar", { token: state.token, ultimos4: $("ult4").value }).then(openForm).catch(function (error) { fail(error.message); }).then(function () { busy(form, false); });
  });
  $("sin-clave").addEventListener("click", function () { openForm(null); });
  $("no-soy").addEventListener("click", function () { $("dni").value = ""; show("dni"); });

  Array.prototype.forEach.call(document.querySelectorAll("[data-group] button"), function (button) {
    button.addEventListener("click", function () { pick(button.parentNode.getAttribute("data-group"), button.getAttribute("data-value")); });
  });

  $("f-datos").addEventListener("submit", function (event) {
    event.preventDefault();
    var form = this;
    var car = state.mode === "CAR";
    var safe = car && state.seguro === "si";
    if (!state.mode) return fail("transporte");
    if ((car && !state.seguro) || (safe && !state.dispuesto) || (!safe && !state.necesita)) return fail("falta");
    if (!Object.keys(ayuda).length) return fail("ayuda");
    busy(form, true);
    api("guardar", {
      token: state.token, nombre: $("nombre").value, servicio: $("servicio").value, rol: $("rol").value, ayuda: Object.keys(ayuda).filter(function (key) { return key !== "ninguno"; }), address: $("address").value, phone: $("phone").value,
      transportMode: state.mode, vehiculoSeguro: safe, dispuesto: safe && state.dispuesto === "si", lugares: Number(state.lugares), necesitaTraslado: !safe && state.necesita === "si"
    }).then(function (data) {
      if (data.revision) $("listo-p").textContent = "Recibimos tus datos. Como cambió algún dato respecto de lo que teníamos, la Dirección los revisa antes de darlos por confirmados.";
      var p = data.progreso;
      if (p && p.total) {
        $("prog").hidden = false;
        var s = p.servicio && p.servicio.total ? p.servicio : null;
        $("bar-s").parentNode.hidden = $("stat-s").hidden = !s;
        if (s) $("stat-s").innerHTML = "<b></b> ya respondieron " + s.respondieron + " de " + s.total, $("stat-s").firstChild.textContent = s.nombre + ":";
        $("stat-t").innerHTML = "<b>Todo el hospital:</b> " + p.respondieron + " de " + p.total;
        setTimeout(function () { if (s) $("bar-s").style.width = Math.round(100 * s.respondieron / s.total) + "%"; $("bar-t").style.width = Math.max(1, Math.round(100 * p.respondieron / p.total)) + "%"; }, 80);
      }
      show("listo");
    }).catch(function (error) { fail(error.message); }).then(function () { busy(form, false); });
  });

  var link = location.origin + "/mis-datos";
  var text = "🏥 Hospital Schestakow: estamos actualizando los datos del personal para organizar traslados si hay una tormenta grave u otra emergencia. Es 1 minuto desde el celular, sólo con tu DNI:\n" + link + "\n\nPor favor reenvialo a tus grupos de trabajo del hospital, así llega a todos. Si te llega repetido no pasa nada: se responde una sola vez.";
  $("share").addEventListener("click", function () {
    if (navigator.share) navigator.share({ text: text }).catch(function () {});
    else window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener");
  });
  $("copy").addEventListener("click", function () {
    var button = this;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { button.textContent = "Enlace copiado"; }).catch(function () { button.textContent = link; });
  });
})();
