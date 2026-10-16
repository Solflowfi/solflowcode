/* SOLFLOW static preview page - REAL wallet connection (no UI redesign).
 * Wires #connect-wallet-btn to genuine browser wallet providers:
 *   Phantom  -> window.phantom?.solana
 *   Solflare -> window.solflare
 *   Backpack -> window.backpack
 * Connect -> shows the real public address; click again -> disconnect.
 * Demo mode / devnet only. No funds are moved by this script.
 */
(function () {
  'use strict';

  var PROVIDERS = [
    { name: 'Phantom', get: function () { return window.phantom && window.phantom.solana; } },
    { name: 'Solflare', get: function () { return window.solflare; } },
    { name: 'Backpack', get: function () { return window.backpack; } },
  ];

  function detect() {
    var found = [];
    for (var i = 0; i < PROVIDERS.length; i++) {
      var p = PROVIDERS[i];
      var provider = p.get();
      if (provider) found.push({ name: p.name, provider: provider });
    }
    return found;
  }

  function setStatus(text) {
    var el = document.getElementById('wallet-status');
    if (el) el.textContent = text;
  }

  function setButton(text) {
    var el = document.getElementById('connect-wallet-btn');
    if (el) el.textContent = text;
  }

  function shortAddr(a) {
    return a.length > 12 ? a.slice(0, 4) + '..' + a.slice(-4) : a;
  }

  var state = { provider: null, account: null };

  function onDisconnected() {
    state.provider = null;
    state.account = null;
    setButton('Connect Wallet');
    setStatus('Disconnected. Devnet · Demo Mode');
  }

  function connect() {
    var wallets = detect();
    if (wallets.length === 0) {
      setStatus('No Solana wallet detected. Install Phantom, Solflare or Backpack.');
      return;
    }
    // Prefer Phantom, then Solflare, then Backpack (detection order above).
    var target = wallets[0];
    var provider = target.provider;
    setStatus('Connecting via ' + target.name + '...');
    Promise.resolve(provider.connect())
      .then(function (res) {
        var acct = res && res.publicKey
          ? (typeof res.publicKey === 'string' ? res.publicKey : res.publicKey.toString())
          : (provider.publicKey && provider.publicKey.toString ? provider.publicKey.toString() : null);
        if (!acct) throw new Error('Wallet did not return a public key.');
        state.provider = provider;
        state.account = acct;
        setButton('DISCONNECT (' + shortAddr(acct) + ')');
        setStatus('Connected via ' + target.name + ': ' + acct + ' · Devnet · Demo Mode');
        if (typeof provider.on === 'function') {
          provider.on('disconnect', onDisconnected);
          provider.on('accountChanged', function () { onDisconnected(); });
        }
      })
      .catch(function (err) {
        setStatus('Connection rejected or failed: ' + (err && err.message ? err.message : 'unknown error'));
      });
  }

  function disconnect() {
    if (!state.provider) return;
    try {
      if (typeof state.provider.disconnect === 'function') {
        Promise.resolve(state.provider.disconnect()).then(onDisconnected, onDisconnected);
      } else {
        onDisconnected();
      }
    } catch {
      onDisconnected();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('connect-wallet-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (state.provider && state.account) disconnect();
      else connect();
    });
    var wallets = detect();
    if (wallets.length > 0) {
      setStatus(wallets.length + ' wallet(s) detected: ' + wallets.map(function (w) { return w.name; }).join(', ') + '. Click Connect Wallet. Devnet · Demo Mode');
    }
  });
})();
