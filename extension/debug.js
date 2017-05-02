'use-strict';

(() => {
  let filter = null;
  const savedRegExpString = window.localStorage.debugRealtime;
  if (savedRegExpString) {
    filter = new RegExp(savedRegExpString.substr(1, savedRegExpString.length - 2));
  }
  let level = 'log';
  let opts = {};
  let realtimeLoaded = false;
  let failedToLoadRealtime = false;
  let thawTime = null;

  window.debugRealtime = (_filter, _level, _opts) => {
    if (_opts.thawIce && !_opts.mangleStanzas) {
      _opts.mangleStanzas = [{
        regexp: /ip=".*?"/,
        mangle: (s) => {
          return s.toString().replace(/ip=".*?"/g, 'ip="123.123.123.123"').replace(/rel-addr=".*?"/g, 'rel-addr="123.123.123.123"');
        }
      }, {
        regexp: /ufrag=".*?"/,
        mangle: (s) => {
          return s.toString().replace(/ufrag=".*?"/g, 'ufrag="123a"').replace(/pwd="/g, 'pwd="asd').replace(/:..<\/finger/g, ':00</finger');
        }
      }];
      return window.debugRealtime(_filter, _level, _opts);
    }
    if (failedToLoadRealtime) {
      return console.error('failed to load realtime. cannot debug');
    }

    if (!realtimeLoaded) {
      console.warn('realtime is not loaded yet');
    }

    if (_filter && typeof _filter.test === 'function') {
      filter = _filter;
      window.localStorage.debugRealtime = filter;
    } else {
      console.warn('Failed to set debug filter - must be regexp or object with function `test`');
    }

    opts.absoluteTime = _opts && _opts.absoluteTime;
    opts.filterRealtime = _opts && _opts.filterRealtime;
    opts.mangleStanzas = _opts && _opts.mangleStanzas;
    opts.thawIce = _opts && _opts.thawIce;
    opts.refreeze = _opts && _opts.refreeze;
    thawTime = null;
    if (typeof opts.filterRealtime === 'string') {
      opts.filterRealtime = new RegExp(opts.filterRealtime);
    }

    if (['error', 'warn', 'info', 'log', 'debug'].indexOf(_level) > -1) {
      level = _level;
    }
  };

  // formatDelta taken from https://github.com/latentflip/websocket-debug/blob/master/script.js
  // nicely format time delta (delta is in milliseconds)
  // 0->9:        "+Nms  "
  // 10->99:      "+NNms "
  // 100->999:    "+NNNms"
  // 1000->9999   "+N.NNs"
  // 10000->59999 "+NN.Ns"
  // 60000+       "+NNmNNs
  const formatDelta = (delta) => {
    const ONE_MINUTE = 60 * 1000;

    // pos/neg sign
    const s = delta >= 0 ? '+' : '-';

    // ms only
    if (delta < 10) { return `${s}${delta}ms  `; }
    if (delta < 100) { return `${s}${delta}ms `; }
    if (delta < 1000) { return `${s}${delta}ms`; }

    // secs
    if (delta < 10000) {
      const secs = delta / 1000;
      // 2 decimal places ideally, but toFixed rounds up
      return `${s}${secs.toFixed(2).substr(0, 4)}s`;
    }

    if (delta < ONE_MINUTE) {
      const secs = delta / 1000;

      return `${s}${secs.toFixed(1).substr(0, 4)}s`;
    }

    // mins + secs
    {
      const mins = Math.floor(delta / ONE_MINUTE);
      const secs = Math.floor((delta - (mins * ONE_MINUTE)) / 1000);
      return `${s}${mins}m${secs}s`;
    }
  };

  const prettyPrintXml = (xml) => {
    const parser = new window.DOMParser();
    return parser.parseFromString(xml, 'text/xml').firstChild;
  };

  const shouldLog = (stanza) => {
    if (!filter) {
      return false;
    }

    return filter.test(stanza);
  };

  const shouldSend = (stanza) => {
    if (!opts.filterRealtime) {
      return true;
    }

    return !opts.filterRealtime.test(stanza);
  };

  const maybeMangle = (stanza) => {
    if (!opts.mangleStanzas || !opts.mangleStanzas.length) {
      return stanza;
    }
    // Refreeze turns off stanza mangling after a time
    if (opts.refreeze && thawTime && new Date().getTime() - thawTime > (opts.refreeze || 1000)) {
      console.log('refreezing!');
      opts.mangleStanzas = null;
      return stanza;
    }
    const mangler = opts.mangleStanzas.find((m) => m.regexp.test(stanza));
    if (!mangler) {
      return stanza;
    }
    if (opts.refreeze) {
      console.log('setting thaw time');
      thawTime = new Date().getTime();
    }
    const mangled = mangler.mangle(stanza);
    console[level]('mangled', stanza, mangled);
    return mangled;
  };

  let lastStanzaTime = null;

  const logStanza = (direction, stanza) => {
    if (!shouldLog(stanza)) {
      return;
    }
    const now = new Date();
    const time = lastStanzaTime ? now.getTime() - lastStanzaTime : 0;
    const formattedTime = opts.absoluteTime ? now.toISOString() : formatDelta(time);
    const css = direction === '⬆' ? 'color:red' : 'color:green';

    if (['presence', 'iq', 'message'].indexOf(stanza.name) > -1 ||
          /<iq|<message|<presence/.test(stanza)) {
      const prettyStanza = prettyPrintXml(stanza.toString());
      console[level](`[realtime] %c${direction}`, css, formattedTime, prettyStanza);
    } else {
      console[level]('unknown stanza', stanza);
    }
    lastStanzaTime = new Date().getTime();
  };

  console.debug('content script loaded');
  const realtime = new Promise((resolve, reject) => {
    let count = 0;
    const findRealtime = () => {
      if (count > 100) {
        console.debug('failed to load realtime');
        failedToLoadRealtime = true;
        return reject();
      }
      if (window.Realtime && window.Realtime._instances) {
        const instances = window.Realtime._instances();
        if (instances.length && instances[0].socket) {
          return resolve(instances[0]);
        }
      }
      count++;
      setTimeout(findRealtime, 500);
    };

    findRealtime();
  });

  realtime.then((instance) => {
    console.debug('got rt instance', instance);
    instance.socket.on('stanza', (stanza) => {
      logStanza('⬇', stanza);
    });

    const send = instance._server.send.bind(instance._server);
    instance._server.send = function (stanza) {
      if (shouldSend(stanza)) {
        stanza = maybeMangle(stanza);
        logStanza('⬆', stanza);
        send(...arguments);
      } else {
        console[level]('dropped', stanza);
      }
    };

    realtimeLoaded = true;
  });
})();
