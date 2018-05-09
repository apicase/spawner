import omit from "nanoutils/lib/omit"
import Eventbus from "delightful-bus"
import { apicase, mergeOptions } from "@apicase/core"

const stripAdapter = omit(["adapter"])

const modes = {
  debounce({ state, options, reqOptions, placeholder, createRequest }) {
    const last = state.queue.slice(-1)[0]
    if (last) last.cancel()
    clearTimeout(state.blockerTicker)
    state.isBlocked = true
    state.blockerTicker = setTimeout(() => {
      state.isBlocked = false
      createRequest()
    }, options.delay)
    state.queue.push(placeholder)
  },
  throttle({ state, options, placeholder, createRequest }) {
    if (state.isBlocked) return
    state.isBlocked = true
    state.blockerTicker = setTimeout(() => {
      state.isBlocked = false
      createRequest()
    }, options.delay)
    state.queue.push(placeholder)
  },
  queue({ state, options, placeholder, createRequest }) {
    const last = state.queue.slice(-1)[0]
    if (last) {
      last.on(
        "finish",
        options.delay
          ? createRequest
          : () => {
              setTimeout(createRequest, options.delay)
            }
      )
    } else {
      createRequest()
    }
    state.queue.push(placeholder)
  },
  interval({
    state,
    spawner,
    options,
    reqOptions,
    placeholder,
    createRequest
  }) {
    const interval = setInterval(() => {
      createRequest()
    }, options.delay)
    placeholder.on("cancel", () => {
      clearInterval(interval)
    })
    state.queue.push(placeholder)
  },
  delay({ state, options, reqOptions, placeholder, createRequest }) {
    const timer = setTimeout(createRequest, options.delay)
    placeholder.on("cancel", () => {
      clearTimeout(timer)
    })
    state.queue.push(placeholder)
  },
  default({ state, placeholder, createRequest }) {
    createRequest()
    state.queue.push(placeholder)
  }
}

export function IncomingRequest() {
  const bus = new Eventbus()

  this.on = bus.on

  let request

  this.promise = new Promise(resolve => {
    bus.on("receive", resolve)
    bus.on("cancel", () => {
      resolve(null)
    })
  })

  this.setRequest = req => {
    bus.emit("receive", req)
    request = bus.sendTo(req)
    this.on = req.on
    this.then = req.then
    this.catch = req.catch
  }

  this.cancel = () => {
    return Promise.resolve(request ? request.cancel() : null).then(() => {
      bus.emit("cancel")
    })
  }

  this.then = cb => this.promise.then(cb)
  this.catch = cb => this.promise.catch(cb)
}

export function ApiSpawner(options) {
  const spawnerOptions = {
    base: options.base || {},
    delay: options.time || 0,
    mode: options.mode || "default"
  }

  const bus = new Eventbus()
  bus.injectObserverTo(this)

  const spawnerState = {
    isCalled: false,
    isBlocked: false,
    blockerTicker: null,
    queue: []
  }

  const createReq = reqOptions => {
    if (spawnerOptions.base.constructor.name === "ApiService") {
      return spawnerOptions.base.doRequest(reqOptions || {})
    } else {
      const mergedOptions = mergeOptions([
        spawnerOptions.base,
        reqOptions || {}
      ])
      return bus.sendTo(
        apicase(mergedOptions.adapter)(stripAdapter(mergedOptions))
      )
    }
  }

  this.spawn = reqOptions => {
    const placeholder = new IncomingRequest()
    const remove = () => {
      const idx = spawnerState.queue.indexOf(placeholder)
      spawnerState.queue.splice(idx, 1)
    }
    placeholder.on("finish", remove).on("cancel", remove)
    const callback =
      typeof spawnerOptions.mode === "function"
        ? spawnerOptions.mode
        : modes[spawnerOptions.mode]

    callback({
      state: spawnerState,
      options: spawnerOptions,
      spawner: this,
      reqOptions: reqOptions,
      placeholder: placeholder,
      createRequest: () => placeholder.setRequest(createReq(reqOptions))
    })
    return placeholder
  }

  this.stop = () => {
    spawnerState.queue.forEach(req => {
      req.cancel()
    })
  }
}
