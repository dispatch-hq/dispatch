import * as handlers from './commands'
import { factory } from './init'

// Automatically loads all command handlers in src/commands/
export default factory.discord().loader(Object.values(handlers))