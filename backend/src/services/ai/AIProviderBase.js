export class AIProviderBase {
  async run({ model, prompt, config = {} }) {
    throw new Error(`${this.constructor.name}.run() is not implemented`)
  }
  get name() {
    throw new Error('Provider must define a name getter')
  }
}
