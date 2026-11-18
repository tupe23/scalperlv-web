(() => {
  const groups = new Map();
  const setCache = new Map();
  const historyCache = new Map();
  const picker = document.querySelector('#setPicker');
  const marketMessage = document.querySelector('#marketMessage');
  const marketResults = document.querySelector('#marketResults');
  const eurFormat = value => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0);
  const localDateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const todayIso = () => localDateKey(new Date());
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const errorMessage = error => error?.name === 'AbortError'
    ? 'La consulta tardó demasiado. Comprueba la conexión e inténtalo de nuevo.'
    : error?.message || 'Error de conexión.';
  const normalize = value => String(value || '').toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

  // Keep the form key element for legacy handlers, but remove the obsolete key UI.
  document.querySelector('.market-key')?.remove();
  const keyInput = document.querySelector('#apiKey');
  if (keyInput) {
    keyInput.hidden = true;
    document.body.append(keyInput);
    keyInput.closest('.catalog-search')?.remove();
  }
  document.querySelector('#saveApiKey')?.closest('.catalog-search')?.remove();
  products = products.map(product => ({ ...product, language: product.language || 'Inglés' }));
  localStorage.setItem(KEY, JSON.stringify(products));

  async function loadGroups() {
    try {
      const response = await fetchWithTimeout('https://tcgcsv.com/tcgplayer/3/groups');
      if (!response.ok) throw new Error(`TCGCSV ${response.status}`);
      const rows = (await response.json()).results || [];
      picker.innerHTML = '<option value="">Elige colección</option>';
      rows.forEach(group => {
        groups.set(String(group.groupId), { id: String(group.groupId), name: group.name });
        const option = document.createElement('option');
        option.value = group.groupId;
        option.textContent = group.name;
        picker.append(option);
      });
      marketMessage.textContent = 'Elige una colección y busca cartas o productos sellados.';
    } catch (error) {
      marketMessage.textContent = `No se pudieron cargar las colecciones: ${errorMessage(error)}`;
    }
  }

  async function loadSet(groupId) {
    if (setCache.has(groupId)) return setCache.get(groupId);
    const request = (async () => {
      const base = `https://tcgcsv.com/tcgplayer/3/${encodeURIComponent(groupId)}`;
      const [productResponse, priceResponse] = await Promise.all([fetchWithTimeout(`${base}/products`), fetchWithTimeout(`${base}/prices`)]);
      if (!productResponse.ok || !priceResponse.ok) throw new Error('No se pudo consultar TCGCSV.');
      const [productBody, priceBody] = await Promise.all([productResponse.json(), priceResponse.json()]);
      const priceByProduct = new Map();
      (priceBody.results || []).forEach(row => {
        const key = String(row.productId);
        const previous = priceByProduct.get(key);
        if (!previous || ['normal', 'holofoil'].includes(String(row.subTypeName).toLowerCase())) priceByProduct.set(key, row);
      });
      const group = groups.get(String(groupId));
      return (productBody.results || []).map(product => {
        const id = String(product.productId);
        const price = priceByProduct.get(id);
        const extended = product.extendedData || [];
        const isCard = extended.some(item => ['number', 'rarity'].includes(String(item.name || '').toLowerCase()));
        return {
          id, name: product.name || '', set_name: group?.name || '',
          product_type: isCard ? 'Cards' : 'Sealed Products',
          market_price: price?.marketPrice == null ? null : Number(price.marketPrice),
          printing: price?.subTypeName || '', image_url: product.imageUrl || '',
          tcgplayer_id: id, market_price_as_of: todayIso(),
          catalog_url: product.url || ''
        };
      });
    })();
    setCache.set(groupId, request);
    try { return await request; } catch (error) { setCache.delete(groupId); throw error; }
  }

  function openAddProduct(product) {
    const form = document.querySelector('#productForm');
    form.reset();
    form.elements.date.value = today();
    form.elements.name.value = product.name || '';
    const sealed = product.product_type === 'Sealed Products';
    const name = (product.name || '').toLowerCase();
    form.elements.type.value = sealed
      ? (name.includes('etb') || name.includes('elite trainer') ? 'ETB' : name.includes('booster') && !name.includes('box') ? 'Sobre' : 'Caja')
      : 'Carta';
    form.elements.set.value = product.set_name || '';
    form.elements.market.value = product.market_price ?? '';
    form.elements.catalogId.value = product.id || '';
    form.elements.subtype.value = product.printing || '';
    form.elements.imageUrl.value = product.image_url || '';
    form.elements.catalogUrl.value = product.catalog_url || (product.tcgplayer_id ? `https://www.tcgplayer.com/product/${product.tcgplayer_id}` : '');
    form.elements.priceDate.value = product.market_price_as_of || todayIso();
    document.querySelector('#catalogResults').innerHTML = '';
    document.querySelector('#productDialog').showModal();
  }
  window.fillCatalogProduct = openAddProduct;

  window.runMarketSearch = async (query, type = '') => {
    const groupId = picker.value;
    if (!groupId) { marketMessage.textContent = 'Elige primero una colección.'; return; }
    const term = String(query || '').trim();
    if (term.length < 2) { marketMessage.textContent = 'Escribe al menos dos caracteres.'; return; }
    marketMessage.textContent = 'Buscando en TCGCSV…';
    marketResults.innerHTML = '';
    try {
      const all = await loadSet(groupId);
      const ownership = document.querySelector('#marketOwned').value;
      const direction = document.querySelector('#marketSort').value;
      marketItems = all.filter(product => {
        const matches = normalize(product.name).includes(normalize(term));
        const matchesType = !type || product.product_type === type;
        const owned = products.some(item => String(item.catalogId) === String(product.id));
        return matches && matchesType && (ownership === 'all' || (ownership === 'owned' && owned) || (ownership === 'not-owned' && !owned));
      });
      if (direction === 'name') marketItems.sort((a, b) => a.name.localeCompare(b.name));
      if (direction === 'price_desc') marketItems.sort((a, b) => (b.market_price || 0) - (a.market_price || 0));
      if (direction === 'price_asc') marketItems.sort((a, b) => (a.market_price || 0) - (b.market_price || 0));
      marketMessage.textContent = marketItems.length ? `${marketItems.length} resultados · precios TCGCSV en USD.` : 'No se encontraron productos en esta colección.';
      marketResults.innerHTML = marketItems.map((product, index) => {
        const owned = products.some(item => String(item.catalogId) === String(product.id));
        const price = product.market_price == null ? 'Sin precio' : `${usd(product.market_price)} <span>≈ ${eur((product.market_price || 0) * (exchange?.rate || 0))}</span>`;
        return `<article class="market-card">${product.image_url ? `<img src="${safe(product.image_url)}" alt="" loading="lazy">` : '<div class="market-image-placeholder">TCG</div>'}<div class="market-card-info"><span class="tag">${product.product_type === 'Sealed Products' ? 'SELLADO' : 'CARTA'}${product.printing ? ` · ${safe(product.printing)}` : ''}</span><h3>${safe(product.name)}</h3><p>${safe(product.set_name)}</p><div class="market-price">${price}</div><small>TCGCSV · diario</small>${cardmarketLink({name:product.name,set:product.set_name})}<button class="button primary add-market" data-index="${index}">${owned ? '＋ Añadir unidades' : '＋ Añadir a mi colección'}</button></div></article>`;
      }).join('');
      marketResults.querySelectorAll('.add-market').forEach(button => button.onclick = () => openAddProduct(marketItems[Number(button.dataset.index)]));
    } catch (error) {
      marketMessage.textContent = `No se pudo cargar el catálogo: ${errorMessage(error)}`;
    }
  };

  document.querySelector('#marketForm').onsubmit = event => {
    event.preventDefault();
    window.runMarketSearch(document.querySelector('#marketQuery').value, document.querySelector('#marketType').value);
  };
  picker.addEventListener('change', () => {
    const query = document.querySelector('#marketQuery').value.trim();
    if (query.length >= 2) window.runMarketSearch(query, document.querySelector('#marketType').value);
  });
  document.querySelector('#catalogSearch').onclick = async () => {
    const query = document.querySelector('#catalogQuery').value.trim();
    const output = document.querySelector('#catalogResults');
    if (!picker.value) { output.textContent = 'Elige una colección en Mercado primero.'; return; }
    if (query.length < 2) { output.textContent = 'Escribe al menos dos caracteres.'; return; }
    output.textContent = 'Buscando en TCGCSV…';
    try {
      const results = (await loadSet(picker.value)).filter(product => normalize(product.name).includes(normalize(query))).slice(0, 25);
      if (!results.length) { output.textContent = 'No hay resultados.'; return; }
      output.innerHTML = results.map((product, index) => `<button type="button" class="catalog-result" data-index="${index}">${product.image_url ? `<img src="${safe(product.image_url)}" alt="">` : ''}<span><b>${safe(product.name)}</b><small>${safe(product.set_name)} · ${product.market_price == null ? 'Sin precio' : usd(product.market_price)}</small></span></button>`).join('');
      output.querySelectorAll('[data-index]').forEach(button => button.onclick = () => {
        const product = results[Number(button.dataset.index)];
        const form = document.querySelector('#productForm');
        form.elements.name.value = product.name;
        form.elements.type.value = product.product_type === 'Cards' ? 'Carta' : 'Caja';
        form.elements.set.value = product.set_name;
        form.elements.market.value = product.market_price ?? '';
        form.elements.catalogId.value = product.id;
        form.elements.subtype.value = product.printing;
        form.elements.imageUrl.value = product.image_url;
        form.elements.catalogUrl.value = product.catalog_url;
        form.elements.priceDate.value = todayIso();
        output.innerHTML = `Seleccionado: <b>${safe(product.name)}</b>`;
      });
    } catch (error) { output.textContent = `No se pudo buscar: ${errorMessage(error)}`; }
  };

  function sameProduct(left, right) {
    if (left.sold || (left.language || 'Inglés') !== right.language) return false;
    if (left.catalogId && right.catalogId) return String(left.catalogId) === String(right.catalogId);
    return normalize(left.name) === normalize(right.name) && normalize(left.set) === normalize(right.set) && left.type === right.type;
  }
  document.querySelector('#productForm').onsubmit = event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const quantity = Math.max(1, Number.parseInt(data.qty, 10) || 1);
    const incoming = {
      id: crypto.randomUUID(), name: data.name.trim(), type: data.type, set: data.set.trim(), qty: quantity,
      cost: (Number(data.cost) || 0) * quantity, costIsTotal: true, market: Number(data.market) || 0,
      date: data.date, notes: data.notes.trim(), catalogId: data.catalogId, subtype: data.subtype,
      language: data.language || 'Inglés', imageUrl: data.imageUrl, catalogUrl: data.catalogUrl, priceDate: data.priceDate, sold: false
    };
    const matching = products.filter(item => sameProduct(item, incoming));
    if (!matching.length) products.unshift(incoming);
    else {
      const first = matching[0];
      const matchingIds = new Set(matching.map(item => item.id));
      const merged = { ...first, qty: matching.reduce((sum, item) => sum + Number(item.qty || 0), 0) + quantity,
        cost: matching.reduce((sum, item) => sum + Number(item.cost || 0), 0) + incoming.cost,
        market: incoming.market || first.market, imageUrl: incoming.imageUrl || first.imageUrl,
        catalogUrl: incoming.catalogUrl || first.catalogUrl, subtype: incoming.subtype || first.subtype,
        date: incoming.date, priceDate: incoming.priceDate };
      products = products.map(item => item.id === first.id ? merged : matchingIds.has(item.id) ? null : item).filter(Boolean);
    }
    save();
    document.querySelector('#productDialog').close();
  };

  function getProduct(id) { return products.find(item => item.id === id); }
  function updateSaleTotal() {
    const form = document.querySelector('#sellForm');
    const count = Number(form.elements.quantity.value) || 0;
    const unit = Number(form.elements.unitPrice.value) || 0;
    document.querySelector('#sellTotal').textContent = `Total de venta: ${eurFormat(count * unit)}`;
  }
  window.sell = id => {
    const product = getProduct(id);
    if (!product) return;
    const form = document.querySelector('#sellForm');
    form.reset();
    form.elements.id.value = id;
    form.elements.quantity.max = Math.max(1, Number(product.qty) || 1);
    form.elements.quantity.value = 1;
    form.elements.date.value = today();
    updateSaleTotal();
    document.querySelector('#sellDialog').showModal();
  };
  document.querySelectorAll('#sellForm [name="quantity"],#sellForm [name="unitPrice"]').forEach(input => input.addEventListener('input', updateSaleTotal));
  document.querySelector('#sellForm').onsubmit = event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const product = getProduct(data.id);
    const quantity = Number.parseInt(data.quantity, 10);
    const unitPrice = Number(data.unitPrice);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > product.qty || !Number.isFinite(unitPrice) || unitPrice < 0) return;
    const soldCost = Number(product.cost || 0) * quantity / Number(product.qty || 1);
    const total = unitPrice * quantity;
    if (quantity === Number(product.qty)) Object.assign(product, { sold: true, sale: total, saleDate: data.date });
    else {
      product.qty -= quantity;
      product.cost -= soldCost;
      products.unshift({ ...product, id: crypto.randomUUID(), qty: quantity, cost: soldCost, sold: true, sale: total, saleDate: data.date });
    }
    save();
    document.querySelector('#sellDialog').close();
  };
  window.restoreSale = id => {
    const product = getProduct(id);
    if (!product?.sold) return;
    product.sold = false;
    delete product.sale;
    delete product.saleDate;
    save();
  };

  window.totals = () => products.reduce((total, product) => {
    const cost = Number(product.cost) || 0;
    if (product.sold) {
      total.sold += Number(product.sale) || 0;
      total.realized += (Number(product.sale) || 0) - cost;
      total.soldCount++;
    } else {
      total.invested += cost;
      total.value += marketEur(product);
      total.unrealized += marketEur(product) - cost;
      total.owned++;
    }
    return total;
  }, { invested: 0, value: 0, unrealized: 0, realized: 0, sold: 0, owned: 0, soldCount: 0 });

  const originalRender = window.render;
  window.render = () => {
    originalRender();
    renderSales();
    const labels = document.querySelectorAll('.stat-label');
    if (labels[1]) labels[1].textContent = 'Coste de productos en cartera';
    const notes = document.querySelectorAll('.stat-note');
    if (notes[1]) notes[1].textContent = 'Se descuenta el coste de lo vendido';
    document.querySelectorAll('.product').forEach(row => {
      const remove = row.querySelector('.row-actions .del');
      const id = /removeItem\('([^']+)'\)/.exec(remove?.getAttribute('onclick') || '')?.[1];
      const product = id ? getProduct(id) : null;
      if (!product) return;
      const cost = row.querySelector('.metric');
      if (cost && !cost.querySelector('.average-cost')) {
        const average = document.createElement('div');
        average.className = 'product-meta average-cost';
        average.textContent = `Media ${eurFormat(product.cost / Math.max(1, product.qty))}/ud.`;
        cost.append(average);
      }
      const actions = row.querySelector('.row-actions');
      if (product.sold && !actions.querySelector('.restore-sale')) {
        const button = document.createElement('button');
        button.className = 'icon-btn restore-sale';
        button.textContent = 'Recuperar';
        button.onclick = () => window.restoreSale(product.id);
        actions.insertBefore(button, remove);
      }
      if (product.catalogId && !actions.querySelector('.history-button')) {
        const button = document.createElement('button');
        button.className = 'icon-btn history-button';
        button.textContent = 'Gráfica';
        button.onclick = () => window.showHistory(product.id);
        actions.insertBefore(button, remove);
      }
    });
  };
  function renderSales() {
    const sold = products.filter(product => product.sold).sort((a, b) => String(b.saleDate || '').localeCompare(String(a.saleDate || '')));
    const gross = sold.reduce((sum, product) => sum + (Number(product.sale) || 0), 0);
    const cost = sold.reduce((sum, product) => sum + (Number(product.cost) || 0), 0);
    const stats = document.querySelector('#salesStats');
    const list = document.querySelector('#salesTransactions');
    if (!stats || !list) return;
    stats.innerHTML = `<article class="stat"><span class="stat-label">Beneficio realizado</span><strong class="${gross >= cost ? 'positive' : 'negative'}">${eurFormat(gross - cost)}</strong><small class="stat-note">Ingresos ${eurFormat(gross)} · Coste ${eurFormat(cost)}</small></article><article class="stat"><span class="stat-label">Transacciones</span><strong>${sold.length}</strong><small class="stat-note">Un registro por venta</small></article>`;
    document.querySelector('#salesCount').textContent = sold.length;
    list.innerHTML = sold.length ? sold.map(product => {
      const profit = (Number(product.sale) || 0) - (Number(product.cost) || 0);
      return `<article class="product"><div class="product-info"><h3>${safe(product.name)}</h3><small>${safe(product.set || 'Sin colección')} · ${Number(product.qty) || 1} ud. · ${safe(product.saleDate || 'Fecha no registrada')}</small></div><div class="metric"><b>Venta ${eurFormat(product.sale)}</b><small>Coste ${eurFormat(product.cost)}</small></div><strong class="${profit >= 0 ? 'positive' : 'negative'}">${eurFormat(profit)}</strong></article>`;
    }).join('') : '<p class="empty">Todavía no hay ventas registradas.</p>';
  }
  document.querySelectorAll('.main-nav [data-view]').forEach(button => button.onclick = () => {
    document.querySelectorAll('.main-nav .nav-button').forEach(nav => nav.classList.toggle('active', nav === button));
    ['marketView', 'collectionView', 'salesView'].forEach(id => { document.getElementById(id).hidden = id !== button.dataset.view; });
    if (button.dataset.view === 'salesView') renderSales();
  });
  window.save = () => {
    localStorage.setItem(KEY, JSON.stringify(products));
    window.render();
    if (!document.querySelector('#salesView').hidden) renderSales();
  };

  const chartDialog = document.querySelector('#historyDialog');
  let historyProduct = null;
  let historyPoints = [];
  let historyPeriod = 'Todo';
  let selectedIndex = -1;
  const historyPeriods = document.querySelector('#historyPeriods');
  historyPeriods.innerHTML = ['7D', '1M', '3M', '1A', 'Todo'].map(period => `<button class="icon-btn" data-period="${period}">${period}</button>`).join('');
  historyPeriods.querySelectorAll('button').forEach(button => button.onclick = () => { historyPeriod = button.dataset.period; selectedIndex = -1; renderHistory(); });
  document.querySelector('#closeHistory').onclick = () => chartDialog.close();

  function filteredHistory() {
    const days = { '7D': 7, '1M': 30, '3M': 90, '1A': 365 }[historyPeriod];
    if (!days) return historyPoints;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - (days - 1));
    const dateKey = localDateKey(cutoff);
    return historyPoints.filter(point => point.date >= dateKey);
  }
  function fillMissingDays(points) {
    if (points.length < 2) return points;
    const firstDay = Date.parse(`${points[0].date}T12:00:00Z`);
    const lastDay = Date.parse(`${points[points.length - 1].date}T12:00:00Z`);
    if (!Number.isFinite(firstDay) || !Number.isFinite(lastDay)) return points;
    const daily = [];
    let quoteIndex = 0;
    let latest = null;
    for (let timestamp = firstDay; timestamp <= lastDay; timestamp += 86_400_000) {
      const date = new Date(timestamp).toISOString().slice(0, 10);
      while (quoteIndex < points.length && points[quoteIndex].date <= date) latest = points[quoteIndex++];
      if (latest) daily.push({ date, usd: latest.usd, observed: latest.date === date });
    }
    return daily;
  }
  function renderHistory() {
    const observedPoints = filteredHistory();
    const points = fillMissingDays(observedPoints);
    const summary = document.querySelector('#historySummary');
    const chart = document.querySelector('#historyChart');
    historyPeriods.querySelectorAll('button').forEach(button => button.classList.toggle('primary', button.dataset.period === historyPeriod));
    if (!points.length) { summary.textContent = 'No hay precios para este período.'; chart.innerHTML = ''; return; }
    const active = selectedIndex >= 0 ? points[Math.min(selectedIndex, points.length - 1)] : points[points.length - 1];
    const rate = exchange?.rate || 0;
    summary.textContent = `${active.date} · ${eurFormat(active.usd * rate)}`;
    const width = 460, height = 185, pad = 15;
    const values = points.map(point => point.usd);
    let min = Math.min(...values), max = Math.max(...values);
    const extra = Math.max((max - min) * .08, max * .025, .01); min -= extra; max += extra;
    const firstTimestamp = Date.parse(`${points[0].date}T12:00:00Z`);
    const lastTimestamp = Date.parse(`${points[points.length - 1].date}T12:00:00Z`);
    const xAt = index => pad + (points.length <= 1 ? .5 : (Date.parse(`${points[index].date}T12:00:00Z`) - firstTimestamp) / Math.max(1, lastTimestamp - firstTimestamp)) * (width - pad * 2);
    const yAt = value => height - pad - (value - min) * (height - pad * 2) / (max - min);
    const path = points.map((point, index) => `${index ? 'L' : 'M'}${xAt(index).toFixed(1)},${yAt(point.usd).toFixed(1)}`).join(' ');
    const selectX = selectedIndex >= 0 ? xAt(Math.min(selectedIndex, points.length - 1)) : xAt(points.length - 1);
    chart.innerHTML = `<svg id="historySvg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfica diaria de precios, con días sin cotización completados con el último precio conocido"><line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#9aa3b5" opacity=".25"/><path d="${path}" fill="none" stroke="#ccf36a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><line x1="${selectX}" y1="${pad}" x2="${selectX}" y2="${height - pad}" stroke="#9aa3b5" opacity=".7"/><circle cx="${selectX}" cy="${yAt(active.usd)}" r="5" fill="#ccf36a"/></svg><div class="history-dates"><span>${points[0].date}</span><span>${observedPoints.length} cotizaciones · ${points.length} días</span><span>${points[points.length - 1].date}</span></div>`;
    const svg = document.querySelector('#historySvg');
    const select = event => {
      const bounds = svg.getBoundingClientRect();
      const index = Math.round((event.clientX - bounds.left) / Math.max(1, bounds.width) * (points.length - 1));
      selectedIndex = Math.max(0, Math.min(points.length - 1, index));
      renderHistory();
    };
    svg.onpointerdown = select;
    svg.onpointermove = event => { if (event.buttons) select(event); };
  }

  window.showHistory = async id => {
    const product = getProduct(id);
    if (!product?.catalogId) return;
    historyProduct = product;
    historyPeriod = 'Todo';
    selectedIndex = -1;
    document.querySelector('#historyTitle').textContent = product.name;
    document.querySelector('#historySummary').textContent = 'Cargando precios diarios…';
    document.querySelector('#historyChart').innerHTML = '';
    chartDialog.showModal();
    try {
      let request = historyCache.get(product.catalogId);
      if (!request) {
        request = fetchWithTimeout(`https://api.tickermint.cards/products/${encodeURIComponent(product.catalogId)}/prices`).then(response => {
          if (!response.ok) throw new Error(`TickerMint ${response.status}`);
          return response.json();
        });
        historyCache.set(product.catalogId, request);
      }
      const response = await request;
      const variants = Object.entries(response).filter(([, rows]) => Array.isArray(rows));
      const key = normalize(product.subtype || '');
      const variant = variants.find(([name]) => key && normalize(name) === key);
      if (!variant) throw new Error('TickerMint no tiene histórico para este producto.');
      historyPoints = [...new Map(variant[1].map(row => {
        const point = { date: String(row.snapshot_date || '').slice(0, 10), usd: Number(row.market) };
        return [point.date, point];
      }).filter(([date, point]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(point.usd) && point.usd > 0))]
        .map(([, point]) => point).sort((a, b) => a.date.localeCompare(b.date));
      if (!historyPoints.length) throw new Error('TickerMint aún no tiene precios diarios.');
      renderHistory();
    } catch (error) {
      historyCache.delete(product.catalogId);
      document.querySelector('#historySummary').textContent = errorMessage(error);
    }
  };

  loadGroups();
  window.render();
})();
