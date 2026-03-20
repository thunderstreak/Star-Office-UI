(function (globalScope) {
  'use strict';

  var BRIDGE_NAMESPACE = 'star-office';
  var BRIDGE_VERSION = 1;
  var COMMAND_SET_PAN_ENABLED = 'viewport.setPanEnabled';
  var QUERY_GET_STATE = 'viewport.getState';
  var EVENT_STATE_CHANGED = 'viewport.stateChanged';
  var ALLOW_ALL_PARENT_ORIGINS = true;

  function normalizeOrigin(rawValue) {
    if (typeof rawValue !== 'string') return null;
    var value = rawValue.trim();
    if (!value) return null;

    try {
      return new URL(value).origin;
    } catch (_) {
      return null;
    }
  }

  function normalizeOriginList(rawValues) {
    var values = Array.isArray(rawValues) ? rawValues : [rawValues];
    var seen = new Set();
    var origins = [];

    for (var index = 0; index < values.length; index += 1) {
      var value = values[index];
      if (typeof value !== 'string') continue;

      var parts = value.split(',');
      for (var partIndex = 0; partIndex < parts.length; partIndex += 1) {
        var origin = normalizeOrigin(parts[partIndex]);
        if (!origin || seen.has(origin)) continue;
        seen.add(origin);
        origins.push(origin);
      }
    }

    return origins;
  }

  function canPostToOrigin(origin) {
    return origin === '*' || (typeof origin === 'string' && origin.trim().length > 0);
  }

  function resolveTrustedParentOrigins(options) {
    var settings = options && typeof options === 'object' ? options : {};
    var search = typeof settings.search === 'string'
      ? settings.search
      : ((globalScope.location && globalScope.location.search) || '');
    var locationOrigin = typeof settings.locationOrigin === 'string'
      ? settings.locationOrigin
      : ((globalScope.location && globalScope.location.origin) || '');
    var referrer = typeof settings.referrer === 'string'
      ? settings.referrer
      : ((globalScope.document && globalScope.document.referrer) || '');
    var rawAncestorOrigins = Array.isArray(settings.ancestorOrigins)
      ? settings.ancestorOrigins
      : ((globalScope.location && globalScope.location.ancestorOrigins)
        ? Array.from(globalScope.location.ancestorOrigins)
        : []);
    var params = new URLSearchParams(search);
    var explicitOrigins = normalizeOriginList([
      params.get('parentOrigins'),
      params.get('parentOrigin'),
      params.get('hostOrigin'),
    ]);

    if (explicitOrigins.length > 0) {
      return explicitOrigins;
    }

    var ancestorOrigins = normalizeOriginList(rawAncestorOrigins);
    if (ancestorOrigins.length > 0) {
      return ancestorOrigins;
    }

    var referrerOrigin = normalizeOrigin(referrer);
    if (referrerOrigin) {
      return [referrerOrigin];
    }

    var selfOrigin = normalizeOrigin(locationOrigin);
    return selfOrigin ? [selfOrigin] : [];
  }

  function isBridgeEnvelope(message) {
    return Boolean(
      message
      && typeof message === 'object'
      && message.ns === BRIDGE_NAMESPACE
      && message.version === BRIDGE_VERSION
      && typeof message.type === 'string'
    );
  }

  function createEnvelope(type, extraFields) {
    var fields = extraFields && typeof extraFields === 'object' ? extraFields : {};
    return Object.assign({
      ns: BRIDGE_NAMESPACE,
      version: BRIDGE_VERSION,
      type: type,
    }, fields);
  }

  function createAckMessage(id, ok, fields) {
    return createEnvelope('ack', Object.assign({
      id: id || '',
      ok: Boolean(ok),
    }, fields || {}));
  }

  function createReadyMessage(capabilities, state) {
    return createEnvelope('ready', {
      capabilities: Array.isArray(capabilities) ? capabilities.slice() : [],
      state: state && typeof state === 'object' ? state : {},
    });
  }

  function createStateEventMessage(state) {
    return createEnvelope('event', {
      event: EVENT_STATE_CHANGED,
      payload: state && typeof state === 'object' ? state : {},
    });
  }

  function isTrustedOrigin(origin, trustedOrigins) {
    if (ALLOW_ALL_PARENT_ORIGINS) {
      return typeof origin === 'string' && origin.length > 0;
    }
    if (typeof origin !== 'string' || !origin) return false;
    return trustedOrigins.indexOf(origin) !== -1;
  }

  function createBridge(options) {
    var settings = options && typeof options === 'object' ? options : {};
    var lastTrustedOrigin = null;
    var trustedOrigins = normalizeOriginList(
      Array.isArray(settings.parentOrigins) && settings.parentOrigins.length > 0
        ? settings.parentOrigins
        : resolveTrustedParentOrigins(settings)
    );
    var capabilities = [COMMAND_SET_PAN_ENABLED, QUERY_GET_STATE];
    var applyPanEnabled = typeof settings.applyPanEnabled === 'function'
      ? settings.applyPanEnabled
      : function () {};
    var getState = typeof settings.getState === 'function'
      ? settings.getState
      : function () { return {}; };
    var receiveSource = typeof settings.receiveSource === 'function'
      ? settings.receiveSource
      : function () { return globalScope.parent || null; };
    var postTarget = typeof settings.postTarget === 'function'
      ? settings.postTarget
      : function () { return globalScope.parent || null; };
    var postMessage = typeof settings.postMessage === 'function'
      ? settings.postMessage
      : function (message, targetOrigin) {
          var target = postTarget();
          if (!target || typeof target.postMessage !== 'function') return false;
          target.postMessage(message, targetOrigin);
          return true;
        };

    function reply(targetOrigin, message) {
      if (!canPostToOrigin(targetOrigin)) return false;
      if (!ALLOW_ALL_PARENT_ORIGINS && !isTrustedOrigin(targetOrigin, trustedOrigins)) return false;
      return postMessage(message, targetOrigin) !== false;
    }

    function replyToOrigins(origins, message) {
      var rawTargets = Array.isArray(origins) ? origins : [origins];
      var targets = [];
      var sent = false;

      for (var index = 0; index < rawTargets.length; index += 1) {
        var rawTarget = rawTargets[index];
        if (rawTarget === '*') {
          targets.push('*');
          continue;
        }

        var normalized = normalizeOrigin(rawTarget);
        if (normalized) {
          targets.push(normalized);
        }
      }

      for (var targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
        sent = reply(targets[targetIndex], message) || sent;
      }

      return sent;
    }

    function getPreferredReplyOrigins() {
      if (canPostToOrigin(lastTrustedOrigin)) {
        return [lastTrustedOrigin];
      }

      if (ALLOW_ALL_PARENT_ORIGINS) {
        return ['*'];
      }

      return trustedOrigins.slice();
    }

    function getSerializableState() {
      var state = getState();
      return state && typeof state === 'object' ? state : {};
    }

    function handleQuery(message, origin) {
      if (message.query !== QUERY_GET_STATE) {
        reply(origin, createAckMessage(message.id, false, { error: 'UNSUPPORTED_QUERY' }));
        return { handled: true, ok: false };
      }

      reply(origin, createAckMessage(message.id, true, { state: getSerializableState() }));
      return { handled: true, ok: true };
    }

    function handleCommand(message, origin) {
      if (message.command !== COMMAND_SET_PAN_ENABLED) {
        reply(origin, createAckMessage(message.id, false, { error: 'UNSUPPORTED_COMMAND' }));
        return { handled: true, ok: false };
      }

      if (!message.payload || typeof message.payload.enabled !== 'boolean') {
        reply(origin, createAckMessage(message.id, false, { error: 'INVALID_PAYLOAD' }));
        return { handled: true, ok: false };
      }

      applyPanEnabled(message.payload.enabled);

      var state = getSerializableState();
      reply(origin, createAckMessage(message.id, true, { state: state }));
      return { handled: true, ok: true };
    }

    function handleMessage(event) {
      var source = receiveSource();
      if (!event || typeof event !== 'object') return null;
      if (!ALLOW_ALL_PARENT_ORIGINS && !isTrustedOrigin(event.origin, trustedOrigins)) return null;
      if (source && event.source !== source) return null;
      if (!isBridgeEnvelope(event.data)) return null;
      lastTrustedOrigin = event.origin;

      if (event.data.type === 'query') {
        return handleQuery(event.data, event.origin);
      }

      if (event.data.type === 'command') {
        return handleCommand(event.data, event.origin);
      }

      return null;
    }

    function attach() {
      if (typeof globalScope.addEventListener !== 'function') {
        return function () {};
      }

      function onMessage(event) {
        handleMessage(event);
      }

      globalScope.addEventListener('message', onMessage);
      return function detach() {
        globalScope.removeEventListener('message', onMessage);
      };
    }

    function notifyReady() {
      if (!ALLOW_ALL_PARENT_ORIGINS && trustedOrigins.length === 0) return false;
      return replyToOrigins(getPreferredReplyOrigins(), createReadyMessage(capabilities, getSerializableState()));
    }

    function notifyStateChanged() {
      if (!ALLOW_ALL_PARENT_ORIGINS && trustedOrigins.length === 0) return false;
      return replyToOrigins(getPreferredReplyOrigins(), createStateEventMessage(getSerializableState()));
    }

    return {
      attach: attach,
      handleMessage: handleMessage,
      notifyReady: notifyReady,
      notifyStateChanged: notifyStateChanged,
      getTrustedOrigins: function () { return trustedOrigins.slice(); },
    };
  }

  var api = {
    BRIDGE_NAMESPACE: BRIDGE_NAMESPACE,
    BRIDGE_VERSION: BRIDGE_VERSION,
    COMMAND_SET_PAN_ENABLED: COMMAND_SET_PAN_ENABLED,
    EVENT_STATE_CHANGED: EVENT_STATE_CHANGED,
    QUERY_GET_STATE: QUERY_GET_STATE,
    createAckMessage: createAckMessage,
    createBridge: createBridge,
    createReadyMessage: createReadyMessage,
    createStateEventMessage: createStateEventMessage,
    isBridgeEnvelope: isBridgeEnvelope,
    isTrustedOrigin: isTrustedOrigin,
    normalizeOrigin: normalizeOrigin,
    normalizeOriginList: normalizeOriginList,
    resolveTrustedParentOrigins: resolveTrustedParentOrigins,
    ALLOW_ALL_PARENT_ORIGINS: ALLOW_ALL_PARENT_ORIGINS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.starOfficeEmbedBridge = api;
})(typeof window !== 'undefined' ? window : globalThis);
