import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import ora from 'ora';

export function createAction(...scripts) {
    return new ActionRunner(scripts);
}

class ActionRunner {
    constructor(scripts) {
        this.scripts = scripts;
    }

    async run(context) {
        for (const script of this.scripts) {
            context = await this.runAction(script, context);
        }
        return context;
    }

    async runAction(action, context) {
        const maxRetries = 3;
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const spinner = ora(`Loading ${action.name || 'action'}${attempt > 1 ? ` (attempt ${attempt}/${maxRetries})` : ''}`).start();
            
            try {
                spinner.text = `Executing ${action.name || 'action'}${attempt > 1 ? ` (attempt ${attempt}/${maxRetries})` : ''}`;
                const result = await action(context);
                
                if (result && typeof result === 'object') {
                    context = { ...context, ...result };
                }
                
                spinner.succeed(`Completed: ${action.name || 'action'}`);
                return context;
            } catch (error) {
                lastError = error;
                spinner.fail(`Error executing ${action.name || 'action'} (attempt ${attempt}/${maxRetries}): ${error.message}`);
                
                if (attempt < maxRetries) {
                    console.log(`Retrying ${action.name || 'action'} in 2 seconds...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }
        
        // If we get here, all retries failed
        throw new Error(`Failed to execute ${action.name || 'action'} after ${maxRetries} attempts. Last error: ${lastError.message}`);
    }
}
