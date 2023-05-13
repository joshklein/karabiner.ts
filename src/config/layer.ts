import {
  FromKeyCode,
  FromOnlyKeyCode,
  fromOnlyKeyCodes,
  StickyModifierKeyCode,
  stickyModifierKeyCodes,
  toOnlyKeyCodes,
} from '../karabiner/key-code'
import {
  BasicManipulator,
  Condition,
  FromEvent,
  Manipulator,
  Rule,
  ToVariable,
} from '../karabiner/karabiner-config'
import { getKeyWithAlias, ModifierKeyAlias } from '../utils/key-alias'
import { FromKeyParam, map } from './from'
import { toSetVar } from './to'
import { buildCondition, ConditionBuilder, ifVar } from './condition'
import { BasicRuleBuilder } from './rule'
import { toArray } from '../utils/to-array'
import { BuildContext } from '../utils/build-context'
import { BasicManipulatorBuilder } from './manipulator'
import { FromModifierParam, ModifierParam, SideModifierAlias } from './modifier'
import {
  FromModifierOverloadParam,
  parseFromModifierOverload,
} from '../utils/from-modifier-overload'
import { FromOptionalModifierParam } from '../utils/optional-modifiers'

export type LayerKeyCode = Exclude<
  FromKeyCode,
  FromOnlyKeyCode | StickyModifierKeyCode
>
export type LayerKeyParam =
  | Exclude<
      FromKeyParam,
      | FromOnlyKeyCode
      | StickyModifierKeyCode
      | ModifierKeyAlias
      | SideModifierAlias
    >
  | '⇪'

export const excludeFromLayerKeys = [
  ...toOnlyKeyCodes,
  ...fromOnlyKeyCodes,
  ...stickyModifierKeyCodes,
]

/** @see https://github.com/yqrashawn/GokuRakuJoudo/blob/master/tutorial.md#advance3 */
export function layer(
  key: LayerKeyParam | LayerKeyParam[],
  varName?: string,
  onValue: ToVariable['value'] = 1,
  offValue: ToVariable['value'] = 0,
) {
  return new LayerRuleBuilder(key, varName, onValue, offValue)
}

export function modifierLayer(
  modifiers: ModifierParam,
  key: LayerKeyParam | LayerKeyParam[],
  varName?: string,
  onValue: ToVariable['value'] = 1,
  offValue: ToVariable['value'] = 0,
) {
  return layer(key, varName, onValue, offValue).modifiers(modifiers)
}

export function hyperLayer(
  key: LayerKeyParam | LayerKeyParam[],
  varName?: string,
  onValue: ToVariable['value'] = 1,
  offValue: ToVariable['value'] = 0,
) {
  return modifierLayer('Hyper', key, varName, onValue, offValue)
}

export class LayerRuleBuilder extends BasicRuleBuilder {
  protected readonly keys: LayerKeyCode[]
  protected varName: string
  protected layerCondition: ConditionBuilder
  protected layerKeyManipulator?: BasicManipulatorBuilder
  protected replaceLayerKeyToIfAlone = false

  protected layerModifiers?: FromEvent['modifiers']

  constructor(
    key: LayerKeyParam | LayerKeyParam[],
    varName?: string,
    protected readonly onValue: ToVariable['value'] = 1,
    protected readonly offValue: ToVariable['value'] = 0,
  ) {
    const keys = toArray(key).map((v) =>
      getKeyWithAlias<LayerKeyCode>(v, excludeFromLayerKeys, 'as layer key'),
    )
    if (!varName) {
      varName = `layer-${keys.join('-')}`
    }

    super(`Layer - ${varName}`)
    this.keys = keys
    this.varName = varName
    this.layerCondition = ifVar(this.varName, this.onValue)
    this.condition(this.layerCondition)
    this.allowEmptyManipulators = true
  }

  /** Set the layer modifiers. */
  public modifiers(
    mandatoryModifiers?: FromModifierOverloadParam,
    optionalModifiers?: FromModifierParam,
  ): this
  /** Set the layer modifiers to { optional: [...]} */
  public modifiers(modifiers: FromOptionalModifierParam): this
  public modifiers(
    mandatoryModifiers?: FromModifierOverloadParam,
    optionalModifiers?: FromModifierParam,
  ): this {
    this.layerModifiers =
      mandatoryModifiers || optionalModifiers
        ? parseFromModifierOverload(mandatoryModifiers, optionalModifiers)
        : undefined
    return this
  }

  /** Config the layer key. */
  public configKey(
    config: (
      manipulator: Omit<
        BasicManipulatorBuilder,
        'description' | 'condition' | 'parameters' | 'build'
      >,
    ) => void,
    replaceToIfAlone = false,
  ): this {
    if (!this.layerKeyManipulator) {
      this.layerKeyManipulator = map('fn')
    }
    config(this.layerKeyManipulator)
    this.replaceLayerKeyToIfAlone = replaceToIfAlone
    return this
  }

  public build(context?: BuildContext): Rule {
    const rule = super.build(context)

    const conditions = this.conditions
      .filter((v) => v !== this.layerCondition)
      .map(buildCondition)

    if (
      this.layerModifiers?.mandatory?.length ||
      this.layerModifiers?.optional?.length
    ) {
      rule.manipulators.forEach((v) => this.addModifierAnyToManipulator(v))
    }

    for (const key_code of this.keys) {
      rule.manipulators = [
        ...layerToggleManipulator(
          key_code,
          this.varName,
          this.onValue,
          this.offValue,
          this.layerModifiers,
          conditions,
          context,
          this.layerKeyManipulator,
          this.replaceLayerKeyToIfAlone,
        ),
        ...rule.manipulators,
      ]
    }

    return rule
  }

  // If the layer has modifiers, set manipulator modifiers to { mandatory: ['any'] }
  private addModifierAnyToManipulator(manipulator: Manipulator) {
    if (manipulator.type !== 'basic') return
    if (manipulator.from.modifiers) {
      const { mandatory, optional } = manipulator.from.modifiers
      if (
        optional?.length ||
        (mandatory?.length && (mandatory.length > 1 || mandatory[0] !== 'any'))
      ) {
        throw new Error(
          'Layers with modifiers cannot have modifiers on manipulators',
        )
      }
    }
    manipulator.from.modifiers = { mandatory: ['any'] }
  }
}

export function layerToggleManipulator(
  key_code: LayerKeyCode,
  varName: string,
  onValue: ToVariable['value'],
  offValue: ToVariable['value'],
  modifiers?: FromEvent['modifiers'],
  conditions?: Condition[],
  context?: BuildContext,
  layerKeyManipulator?: BasicManipulatorBuilder,
  replaceLayerKeyToIfAlone?: boolean,
) {
  function mergeManipulator<T extends BasicManipulator | BasicManipulator[]>(
    to: T,
  ): T {
    if (!layerKeyManipulator) return to
    const fromItem = layerKeyManipulator.build()[0]
    const toItem = toArray(to)[0]

    const keys = [
      'to',
      'to_if_alone',
      'to_if_held_down',
      'to_after_key_up',
    ] satisfies Array<keyof BasicManipulator>
    keys.forEach((key) =>
      fromItem[key]?.forEach(
        (v) => (toItem[key] = [...(toItem[key] || []), v]),
      ),
    )
    if (fromItem.to_delayed_action) {
      toItem.to_delayed_action = toItem.to_delayed_action || {
        to_if_invoked: [],
        to_if_canceled: [],
      }
      for (const key of ['to_if_invoked', 'to_if_canceled'] as const) {
        fromItem.to_delayed_action[key].forEach((v) =>
          toItem.to_delayed_action?.[key].push(v),
        )
      }
    }

    if (replaceLayerKeyToIfAlone) {
      toItem.to_if_alone = toItem.to_if_alone?.filter(
        (v) => !('key_code' in v && v.key_code === key_code),
      )
    }

    return to
  }

  const manipulator = map({ key_code, modifiers })
    .toVar(varName, onValue)
    .toAfterKeyUp(toSetVar(varName, offValue))
    .toIfAlone({ key_code })
  if (conditions?.length) manipulator.condition(...conditions)
  if (!context) return mergeManipulator(manipulator.build())

  const key = [
    `layer_${key_code}`,
    ...(modifiers ? [JSON.stringify(modifiers)] : []),
    ...(conditions || []).map((v) => JSON.stringify(v)).sort(),
  ].join('_')
  const exiting = context.getCache<BasicManipulator>(key)
  if (exiting?.to && exiting.to_after_key_up) {
    const sameVar = exiting.to.find(
      (v) => 'set_variable' in v && v.set_variable.name === varName,
    )
    if (!sameVar) {
      exiting.to.push(toSetVar(varName, onValue))
      exiting.to_after_key_up.push(toSetVar(varName, offValue))
    }
    mergeManipulator(exiting)
    return [] // Already added
  }

  const result = manipulator.build(context)
  context.setCache(key, result[0])
  return mergeManipulator(result)
}
