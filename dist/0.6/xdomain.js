// XDomain - v0.6.11 - https://github.com/jpillora/xdomain
// Jaime Pillora <dev@jpillora.com> - MIT Copyright 2014
(function(window,undefined) {var CHECK_INTERVAL, COMPAT_VERSION, XD_CHECK, addMasters, addSlaves, connect, console, createSocket, currentOrigin, document, feature, frames, getFrame, guid, handler, initMaster, initSlave, instOf, jsonEncode, listen, location, log, logger, masters, onMessage, parseUrl, slaves, slice, sockets, startPostMessage, strip, toRegExp, warn, xdomain, xhook, _i, _len, _ref;

slaves = null;

addSlaves = function(s) {
  var origin, path;
  if (slaves === null) {
    slaves = {};
    initMaster();
  }
  for (origin in s) {
    path = s[origin];
    log("adding slave: " + origin);
    slaves[origin] = path;
  }
};

frames = {};

getFrame = function(origin, proxyPath) {
  var frame;
  if (frames[origin]) {
    return frames[origin];
  }
  frame = document.createElement("iframe");
  frame.id = frame.name = guid();
  log("creating iframe " + frame.id);
  frame.src = "" + origin + proxyPath;
  frame.setAttribute('style', 'display:none;');
  document.body.appendChild(frame);
  return frames[origin] = frame.contentWindow;
};

initMaster = function() {
  var convertFormData, convertToArrayBuffer, handleRequest;
  convertToArrayBuffer = function(args, done) {
    var isBlob, isFile, name, obj, reader;
    name = args[0], obj = args[1];
    isBlob = instOf(obj, 'Blob');
    isFile = instOf(obj, 'File');
    if (!(isBlob || isFile)) {
      return 0;
    }
    reader = new FileReader();
    reader.onload = function() {
      args[1] = null;
      if (isFile) {
        args[2] = obj.name;
      }
      return done(['XD_BLOB', args, this.result, obj.type]);
    };
    reader.readAsArrayBuffer(obj);
    return 1;
  };
  convertFormData = function(entries, send) {
    var c;
    entries.forEach(function(args, i) {
      var file, name, value, _i, _len;
      name = args[0], value = args[1];
      if (instOf(value, 'FileList')) {
        entries.splice(i, 1);
        for (_i = 0, _len = value.length; _i < _len; _i++) {
          file = value[_i];
          entries.splice(i, 0, [name, file]);
        }
      }
    });
    c = 0;
    entries.forEach(function(args, i) {
      c += convertToArrayBuffer(args, function(newargs) {
        entries[i] = newargs;
        if (--c === 0) {
          send();
        }
      });
    });
    if (c === 0) {
      send();
    }
  };
  handleRequest = function(request, socket) {
    var entries, obj, send;
    socket.on("xhr-event", function() {
      return request.xhr.dispatchEvent.apply(null, arguments);
    });
    socket.on("xhr-upload-event", function() {
      return request.xhr.upload.dispatchEvent.apply(null, arguments);
    });
    obj = strip(request);
    obj.headers = request.headers;
    if (request.withCredentials) {
      obj.credentials = document.cookie;
    }
    send = function() {
      return socket.emit("request", obj);
    };
    if (request.body) {
      obj.body = request.body;
      if (instOf(obj.body, 'FormData')) {
        entries = obj.body.entries;
        obj.body = ["XD_FD", entries];
        convertFormData(entries, send);
        return;
      }
    }
    send();
  };
  return xhook.before(function(request, callback) {
    var frame, p, socket;
    p = parseUrl(request.url);
    if (!p || p.origin === currentOrigin) {
      return callback();
    }
    if (!slaves[p.origin]) {
      if (p) {
        log("no slave matching: '" + p.origin + "'");
      }
      return callback();
    }
    log("proxying request to slave: '" + p.origin + "'");
    if (request.async === false) {
      warn("sync not supported");
      return callback();
    }
    frame = getFrame(p.origin, slaves[p.origin]);
    socket = connect(frame);
    socket.on("response", function(resp) {
      callback(resp);
      return socket.close();
    });
    request.xhr.addEventListener('abort', function() {
      return socket.emit("abort");
    });
    if (socket.ready) {
      handleRequest(request, socket);
    } else {
      socket.once('ready', function() {
        return handleRequest(request, socket);
      });
    }
  });
};

masters = null;

addMasters = function(m) {
  var origin, path;
  if (masters === null) {
    masters = {};
    initSlave();
  }
  for (origin in m) {
    path = m[origin];
    log("adding master: " + origin);
    masters[origin] = path;
  }
};

initSlave = function() {
  listen(function(origin, socket) {
    var master, masterRegex, pathRegex, regex;
    if (origin === "null") {
      origin = "*";
    }
    pathRegex = null;
    for (master in masters) {
      regex = masters[master];
      try {
        masterRegex = toRegExp(master);
        if (masterRegex.test(origin)) {
          pathRegex = toRegExp(regex);
          break;
        }
      } catch (_error) {}
    }
    if (!pathRegex) {
      warn("blocked request from: '" + origin + "'");
      return;
    }
    socket.once("request", function(req) {
      var args, blob, entries, fd, k, p, v, xhr, _i, _len, _ref;
      log("request: " + req.method + " " + req.url);
      p = parseUrl(req.url);
      if (!(p && pathRegex.test(p.path))) {
        warn("blocked request to path: '" + p.path + "' by regex: " + pathRegex);
        socket.close();
        return;
      }
      xhr = new XMLHttpRequest();
      xhr.open(req.method, req.url);
      xhr.addEventListener("*", function(e) {
        return socket.emit('xhr-event', e.type, strip(e));
      });
      if (xhr.upload) {
        xhr.upload.addEventListener("*", function(e) {
          return socket.emit('xhr-upload-event', e.type, strip(e));
        });
      }
      socket.once("abort", function() {
        return xhr.abort();
      });
      xhr.onreadystatechange = function() {
        var resp;
        if (xhr.readyState !== 4) {
          return;
        }
        resp = {
          status: xhr.status,
          statusText: xhr.statusText,
          data: xhr.response,
          headers: xhook.headers(xhr.getAllResponseHeaders())
        };
        try {
          resp.text = xhr.responseText;
        } catch (_error) {}
        return socket.emit('response', resp);
      };
      if (req.withCredentials) {
        req.headers['XDomain-Cookie'] = req.credentials;
      }
      if (req.timeout) {
        xhr.timeout = req.timeout;
      }
      if (req.type) {
        xhr.responseType = req.type;
      }
      _ref = req.headers;
      for (k in _ref) {
        v = _ref[k];
        xhr.setRequestHeader(k, v);
      }
      if (req.body instanceof Array && req.body[0] === "XD_FD") {
        fd = new xhook.FormData();
        entries = req.body[1];
        for (_i = 0, _len = entries.length; _i < _len; _i++) {
          args = entries[_i];
          if (args[0] === "XD_BLOB" && args.length === 4) {
            blob = new Blob([args[2]], {
              type: args[3]
            });
            args = args[1];
            args[1] = blob;
          }
          fd.append.apply(fd, args);
        }
        req.body = fd;
      }
      xhr.send(req.body || null);
    });
    log("slave listening for requests on socket: " + socket.id);
  });
  if (window === window.parent) {
    return warn("slaves must be in an iframe");
  } else {
    return window.parent.postMessage("XDPING_" + COMPAT_VERSION, '*');
  }
};

onMessage = function(fn) {
  if (document.addEventListener) {
    return window.addEventListener("message", fn);
  } else {
    return window.attachEvent("onmessage", fn);
  }
};

XD_CHECK = "XD_CHECK";

handler = null;

sockets = {};

jsonEncode = true;

startPostMessage = function() {
  return onMessage(function(e) {
    var d, extra, id, sock;
    d = e.data;
    if (typeof d === "string") {
      if (/^XDPING(_(V\d+))?$/.test(d) && RegExp.$2 !== COMPAT_VERSION) {
        return warn("your master is not compatible with your slave, check your xdomain.js version");
      } else if (/^xdomain-/.test(d)) {
        d = d.split(",");
      } else if (jsonEncode) {
        try {
          d = JSON.parse(d);
        } catch (_error) {
          return;
        }
      }
    }
    if (!(d instanceof Array)) {
      return;
    }
    id = d.shift();
    if (!/^xdomain-/.test(id)) {
      return;
    }
    sock = sockets[id];
    if (sock === null) {
      return;
    }
    if (sock === undefined) {
      if (!handler) {
        return;
      }
      sock = createSocket(id, e.source);
      handler(e.origin, sock);
    }
    extra = typeof d[1] === "string" ? ": '" + d[1] + "'" : "";
    log("receive socket: " + id + ": '" + d[0] + "'" + extra);
    sock.fire.apply(sock, d);
  });
};

createSocket = function(id, frame) {
  var check, checks, emit, pendingEmits, ready, sock,
    _this = this;
  ready = false;
  sock = sockets[id] = xhook.EventEmitter(true);
  sock.id = id;
  sock.once('close', function() {
    sock.destroy();
    return sock.close();
  });
  pendingEmits = [];
  sock.emit = function() {
    var args, extra;
    args = slice(arguments);
    extra = typeof args[1] === "string" ? ": '" + args[1] + "'" : "";
    log("send socket: " + id + ": " + args[0] + extra);
    args.unshift(id);
    if (ready) {
      emit(args);
    } else {
      pendingEmits.push(args);
    }
  };
  emit = function(args) {
    if (jsonEncode) {
      args = JSON.stringify(args);
    }
    frame.postMessage(args, "*");
  };
  sock.close = function() {
    sock.emit('close');
    log("close socket: " + id);
    sockets[id] = null;
  };
  sock.once(XD_CHECK, function(obj) {
    jsonEncode = typeof obj === "string";
    ready = sock.ready = true;
    sock.emit('ready');
    log("ready socket: " + id + " (emit #" + pendingEmits.length + " pending)");
    while (pendingEmits.length) {
      emit(pendingEmits.shift());
    }
  });
  checks = 0;
  check = function() {
    frame.postMessage([id, XD_CHECK, {}], "*");
    if (ready) {
      return;
    }
    if (checks++ >= xdomain.timeout / CHECK_INTERVAL) {
      warn("Timeout waiting on iframe socket");
    } else {
      setTimeout(check, CHECK_INTERVAL);
    }
  };
  setTimeout(check);
  log("new socket: " + id);
  return sock;
};

connect = function(target) {
  var s;
  s = createSocket(guid(), target);
  return s;
};

listen = function(h) {
  handler = h;
};

'use strict';

if (typeof this.define === "function" && this.define.amd) {
  xhook = require("xhook");
} else {

}

xdomain = function(o) {
  xhook.addWithCredentials = true;
  if (!o) {
    return;
  }
  if (o.masters) {
    addMasters(o.masters);
  }
  if (o.slaves) {
    addSlaves(o.slaves);
  }
};

xdomain.masters = addMasters;

xdomain.slaves = addSlaves;

xdomain.debug = false;

xdomain.timeout = 15e3;

CHECK_INTERVAL = 100;

document = window.document;

location = window.location;

currentOrigin = xdomain.origin = location.protocol + '//' + location.host;

guid = function() {
  return 'xdomain-' + Math.round(Math.random() * Math.pow(2, 32)).toString(16);
};

slice = function(o, n) {
  return Array.prototype.slice.call(o, n);
};

console = window.console || {};

logger = function(type) {
  return function(str) {
    str = "xdomain (" + currentOrigin + "): " + str;
    if (type in xdomain) {
      xdomain[type](str);
    }
    if (type === 'log' && !xdomain.debug) {
      return;
    }
    if (type in console) {
      console[type](str);
    } else if (type === 'warn') {
      alert(str);
    }
  };
};

log = logger('log');

warn = logger('warn');

_ref = ['postMessage', 'JSON'];
for (_i = 0, _len = _ref.length; _i < _len; _i++) {
  feature = _ref[_i];
  if (!window[feature]) {
    warn("requires '" + feature + "' and this browser does not support it");
    return;
  }
}

instOf = function(obj, global) {
  if (!(global in window)) {
    return false;
  }
  return obj instanceof window[global];
};

COMPAT_VERSION = "V1";

parseUrl = xdomain.parseUrl = function(url) {
  if (/^((https?:)?\/\/[^\/\?]+)(\/.*)?/.test(url)) {
    return {
      origin: (RegExp.$2 ? '' : location.protocol) + RegExp.$1,
      path: RegExp.$3
    };
  } else {
    log("failed to parse absolute url: " + url);
    return null;
  }
};

toRegExp = function(obj) {
  var str;
  if (obj instanceof RegExp) {
    return obj;
  }
  str = obj.toString().replace(/\W/g, function(str) {
    return "\\" + str;
  }).replace(/\\\*/g, ".*");
  return new RegExp("^" + str + "$");
};

strip = function(src) {
  var dst, k, v, _ref1;
  dst = {};
  for (k in src) {
    if (k === "returnValue") {
      continue;
    }
    v = src[k];
    if ((_ref1 = typeof v) !== "function" && _ref1 !== "object") {
      dst[k] = v;
    }
  }
  return dst;
};

(function() {
  var attrs, fn, k, prefix, script, _j, _k, _len1, _len2, _ref1, _ref2;
  attrs = {
    debug: function(value) {
      if (typeof value !== "string") {
        return;
      }
      return xdomain.debug = value !== "false";
    },
    slave: function(value) {
      var p, s;
      if (!value) {
        return;
      }
      p = parseUrl(value);
      if (!p) {
        return;
      }
      s = {};
      s[p.origin] = p.path;
      return addSlaves(s);
    },
    master: function(value) {
      var m, p;
      if (!value) {
        return;
      }
      if (value === "*") {
        p = {
          origin: "*",
          path: "*"
        };
      } else {
        p = parseUrl(value);
      }
      if (!p) {
        return;
      }
      m = {};
      m[p.origin] = p.path.replace(/^\//, "") ? p.path : "*";
      return addMasters(m);
    }
  };
  _ref1 = document.getElementsByTagName("script");
  for (_j = 0, _len1 = _ref1.length; _j < _len1; _j++) {
    script = _ref1[_j];
    if (/xdomain/.test(script.src)) {
      _ref2 = ['', 'data-'];
      for (_k = 0, _len2 = _ref2.length; _k < _len2; _k++) {
        prefix = _ref2[_k];
        for (k in attrs) {
          fn = attrs[k];
          fn(script.getAttribute(prefix + k));
        }
      }
    }
  }
})();

startPostMessage();

if (typeof this.define === "function" && this.define.amd) {
  define("xdomain", ["xhook"], function(xhook) {
    return xdomain;
  });
} else {
  (this.exports || this).xdomain = xdomain;
}
}.call(this,window));