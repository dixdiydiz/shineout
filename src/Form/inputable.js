import React, { Component } from 'react'
import PropTypes from 'prop-types'
import immer from 'immer'
import { promiseAll, isSameError } from '../utils/errors'
import shallowEqual from '../utils/shallowEqual'
import { curry, compose } from '../utils/func'
import { filterProps } from '../utils/objects'
import { getUidStr } from '../utils/uid'
import validate from '../utils/validate'
import { FORCE_PASS, ERROR_TYPE, IGNORE_VALIDATE } from '../Datum/types'
import { formConsumer } from './formContext'
import { itemConsumer } from './Item'
import { loopConsumer } from './Loop'
import { fieldSetConsumer } from './FieldSet'

const types = ['formDatum', 'disabled']
const consumer = compose(formConsumer(types), itemConsumer, loopConsumer, fieldSetConsumer)

const tryValue = (val, def) => (val === undefined ? def : val)

const beforeValueChange = curry((fn, value, datum) => {
  if (!fn) return value
  const newValue = fn(value, datum)
  return newValue === undefined ? value : newValue
})

export default curry(Origin => consumer(class extends Component {
  static propTypes = {
    beforeChange: PropTypes.func,
    bind: PropTypes.array,
    bindInputToItem: PropTypes.func,
    defaultValue: PropTypes.any,
    fieldSetValidate: PropTypes.func,
    formDatum: PropTypes.object,
    innerFormNamePath: PropTypes.string,
    loopContext: PropTypes.object,
    name: PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.array,
    ]),
    onChange: PropTypes.func,
    onError: PropTypes.func,
    required: PropTypes.bool,
    rules: PropTypes.array,
    type: PropTypes.string,
    unbindInputFromItem: PropTypes.func,
    value: PropTypes.any,
  }

  static defaultProps = {
    onError: () => {},
    rules: [],
  }

  constructor(props) {
    super(props)

    const { defaultValue } = props

    this.state = {
      error: undefined,
      value: props.value || defaultValue,
    }

    this.itemName = getUidStr()

    this.handleChange = this.handleChange.bind(this)
    this.handleUpdate = this.handleUpdate.bind(this)
    this.handleDatumBind = this.handleDatumBind.bind(this)
    this.handleError = this.handleError.bind(this)
    this.validate = this.validate.bind(this)
    this.validateHook = this.validateHook.bind(this)

    this.lastValue = undefined
  }

  componentDidMount() {
    const {
      formDatum, loopContext, name, defaultValue, bindInputToItem,
    } = this.props

    if (formDatum && name) {
      if (Array.isArray(name)) {
        const dv = defaultValue || []

        name.forEach((n, i) =>
          formDatum.bind(n, this.handleUpdate, dv[i], this.validate))

        this.state.value = name.map(n => formDatum.get(n))
      } else {
        formDatum.bind(name, this.handleUpdate, defaultValue, this.validate)
        this.state.value = formDatum.get(name)
      }
    }

    if (bindInputToItem && name) bindInputToItem(name)

    if (loopContext) loopContext.bind(this.validate)
  }

  shouldComponentUpdate(nextProps, nextState) {
    const options = { deep: ['data', 'name', 'rules', 'rule', 'style', 'value'] }
    return !(shallowEqual(nextProps, this.props, options) && shallowEqual(nextState, this.state))
  }

  componentWillUnmount() {
    const {
      formDatum, name, loopContext, unbindInputFromItem,
    } = this.props

    if (formDatum && name) formDatum.unbind(name, this.handleUpdate)
    if (unbindInputFromItem && name) unbindInputFromItem(name)
    if (loopContext) loopContext.unbind(this.validate)
    this.$willUnmount = true
  }

  setState(...args) {
    if (this.$willUnmount) return
    super.setState(...args)
  }

  getValue() {
    const {
      formDatum, name, value, defaultValue,
    } = this.props
    if (formDatum && name) {
      if (Array.isArray(name)) {
        const dv = defaultValue || []
        return name.map((n, i) => tryValue(formDatum.get(n), dv[i]))
      }
      return tryValue(formDatum.get(name), defaultValue)
    }
    return value === undefined && !formDatum ? this.state.value : value
  }

  getError() {
    const { formDatum, name } = this.props
    if (formDatum && name) {
      const names = Array.isArray(name) ? name : [name]
      for (let i = 0, count = names.length; i < count; i++) {
        const error = formDatum.getError(names[i])
        if (error) return error
      }
      return undefined
    }

    return this.state.error
  }

  handleDatumBind(datum) {
    this.datum = datum
  }

  handleError(error) {
    const { formDatum, name, onError } = this.props
    if (formDatum && name) {
      const names = Array.isArray(name) ? name : [name]
      names.forEach((n) => {
        if (!isSameError(error, formDatum.getError(n, true))) {
          formDatum.setError(n, error, true)
        }
      })
    } else {
      this.setState({ error })
    }

    if (!name && onError) onError(this.itemName, error)
  }

  validateHook(customValidate) {
    this.customValidate = customValidate
  }

  validate(value, data) {
    if (value === FORCE_PASS) {
      this.setState({ timestamp: Date.now() })
      this.handleError()
      return Promise.resolve(true)
    }

    const { name, formDatum, bind } = this.props
    const validates = []
    const validateProps = filterProps(this.props, v => typeof v === 'string' || typeof v === 'number')

    if (value === undefined || Array.isArray(name)) value = this.getValue()
    if (this.customValidate) validates.push(this.customValidate())
    if (formDatum && bind) validates.push(formDatum.validateFields(bind))
    if (!data && formDatum) data = formDatum.getValue()

    if (typeof name === 'string' || !name) {
      let rules = [...this.props.rules]
      if (formDatum && name) {
        rules = rules.concat(formDatum.getRule(name))
      }

      if (rules.length === 0) {
        return promiseAll(validates)
      }

      if (this.datum) {
        value = this.datum
        validateProps.type = 'array'
      }
      validates.push(validate(value, data, rules, validateProps).then(() => {
        this.handleError()
        return true
      }).catch((e) => {
        this.handleError(e)
        return e
      }))
    } else if (!formDatum) {
      return promiseAll(validates)
    } else {
      name.forEach((n, i) => {
        let rules = (this.props.rules || [])[n] || []
        rules = rules.concat(formDatum.getRule(n))
        validates.push(validate(value[i], data, rules, validateProps))
      })
    }

    return promiseAll(validates)
  }

  handleChange(value, ...args) {
    const { formDatum, name, fieldSetValidate } = this.props
    const currentValue = this.getValue()
    if (args.length === 0 && shallowEqual(value, currentValue)) {
      return
    }

    const beforeChange = beforeValueChange(this.props.beforeChange)
    if (formDatum && name) {
      value = beforeChange(value, formDatum)
      if (Array.isArray(name)) {
        const nameValues = {}
        name.forEach((n, i) => {
          const v = (value || [])[i]
          if (v !== formDatum.get(n)) nameValues[n] = v
        })
        formDatum.set(nameValues)
      } else {
        formDatum.set(name, value)
      }
    } else {
      value = beforeChange(value, null)
      this.setState({ value })
      this.validate(value).catch(() => {})
    }

    if (this.props.onChange) this.props.onChange(value, ...args)
    if (fieldSetValidate) fieldSetValidate(true)
  }

  handleUpdate(value, sn, type) {
    if (type === ERROR_TYPE) {
      if (value !== this.state.error) this.setState({ error: value })
      return
    }

    // check for performance
    if (type !== FORCE_PASS && shallowEqual(value, this.lastValue)) return
    this.lastValue = value

    const { name } = this.props

    if (typeof name === 'string') {
      this.setState({ value })
      if (type !== IGNORE_VALIDATE) {
        this.validate(type === FORCE_PASS ? FORCE_PASS : value).catch(() => {})
      }
      return
    }

    let newValue = this.getValue()
    newValue = immer(newValue, (draft) => {
      name.forEach((n, i) => {
        if (n === sn) draft[i] = value
      })
    })

    this.setState({ value: newValue })
    if (type !== IGNORE_VALIDATE) {
      this.validate(type === FORCE_PASS ? FORCE_PASS : newValue).catch(() => {})
    }
  }

  render() {
    const {
      formDatum, value, required, loopContext, bind,
      bindInputToItem, unbindInputFromItem, ...other
    } = this.props

    return (
      <Origin
        {...other}
        formDatum={formDatum}
        error={this.getError()}
        value={this.getValue()}
        onChange={this.handleChange}
        onDatumBind={this.handleDatumBind}
        validateHook={this.validateHook}
      />
    )
  }
}))
