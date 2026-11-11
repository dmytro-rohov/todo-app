// Test support for the apps — never loaded by the app itself. recordRoutes() builds an app and lists every route it
// answers with its full path, so an app's test can show that no dynamic route escapes the request limit
// (security.limitDynamicRoutes) and that a new route outside the limited paths makes the test fail:
//
//   const { recordRoutes, samplePath } = require("../vendor/mytko-kit/testing");
//   const { result, routes } = await recordRoutes(() => createApp({ config, pool }));
//   // routes: [{ method: "get", path: "/api/tasks/:id" }, { method: "post", path: "/auth/mytko/start" }, …]
//
// Routes are recorded as the app's routers are made (express.Router(), app.get(…), router.use("/x", child)), so build
// the app inside the callback. Mounted middleware that is not a router (static files, body parsers, the limit itself)
// is not a route and is not listed.

function isRouter(fn) {
  return typeof fn === "function" && Array.isArray(fn.stack);
}

function mountPaths(args) {
  const first = args[0];
  if (typeof first === "string" || first instanceof RegExp) return { paths: [first], fns: args.slice(1) };
  if (Array.isArray(first) && first.length && first.every(item => typeof item === "string" || item instanceof RegExp)) {
    return { paths: first, fns: args.slice(1) };
  }
  return { paths: ["/"], fns: args };
}

const join = (prefix, path) => {
  if (path instanceof RegExp) return `${prefix}${path}`;
  if (path === "/" || path === "") return prefix || "/";
  return `${prefix === "/" ? "" : prefix}${path}`;
};

async function recordRoutes(build, appOf = result => result?.app ?? result) {
  const express = require("express");
  const proto = express.Router.prototype; // the routers of the app and every express.Router()
  const { use, route } = proto;
  const entries = new WeakMap();
  const list = router => {
    if (!entries.has(router)) entries.set(router, []);
    return entries.get(router);
  };
  proto.use = function recordedUse(...args) {
    const { paths, fns } = mountPaths(args);
    for (const fn of fns.flat(Infinity)) if (isRouter(fn)) list(this).push({ kind: "mount", paths, child: fn });
    return use.apply(this, args);
  };
  proto.route = function recordedRoute(path) {
    const created = route.call(this, path);
    list(this).push({ kind: "route", paths: [].concat(path), route: created });
    return created;
  };
  let result;
  try {
    result = await build();
  } finally {
    proto.use = use;
    proto.route = route;
  }
  const routes = [];
  const walk = (router, prefix, seen) => {
    if (seen.has(router)) return;
    seen.add(router);
    for (const entry of entries.get(router) || []) {
      for (const path of entry.paths) {
        const full = join(prefix, path);
        if (entry.kind === "mount") walk(entry.child, full, new Set(seen));
        else for (const method of Object.keys(entry.route.methods)) routes.push({ method: method === "_all" ? "all" : method, path: full });
      }
    }
  };
  walk(appOf(result).router, "", new Set());
  return { result, routes };
}

// A concrete path for a route pattern: parameters become "1", wildcards "x", optional parts are kept.
function samplePath(pattern) {
  return String(pattern).replace(/[{}]/g, "").replace(/:(\w+)/g, "1").replace(/\*(\w+)?/g, "x");
}

module.exports = { recordRoutes, samplePath };
