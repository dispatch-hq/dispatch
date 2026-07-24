import * as handlers from './commands'
import { factory } from './init'

export default factory.discord().loader(Object.values(handlers))
