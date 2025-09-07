import { myFunction, AnotherClass } from './main';

describe('myFunction', () => {
    it('should return the correct result for valid input', () => {
        const input = 5;
        const expectedOutput = 25; // Assuming myFunction squares the input
        const result = myFunction(input);
        expect(result).toBe(expectedOutput);
    });

    it('should handle negative input', () => {
        const input = -3;
        const expectedOutput = 9; // Assuming myFunction still squares the input
        const result = myFunction(input);
        expect(result).toBe(expectedOutput);
    });

    it('should throw an error for non-numeric input', () => {
        const input = 'string' as any; // Casting to any to simulate error case
        expect(() => myFunction(input)).toThrow('Input must be a number');
    });

    it('should return 0 when input is 0', () => {
        const input = 0;
        const expectedOutput = 0; // Assuming myFunction returns 0 for input 0
        const result = myFunction(input);
        expect(result).toBe(expectedOutput);
    });
});

describe('AnotherClass', () => {
    let instance: AnotherClass;

    beforeEach(() => {
        instance = new AnotherClass();
    });

    it('should initialize with default values', () => {
        expect(instance.value).toBe(0); // Assuming default value is 0
    });

    it('should update value correctly', () => {
        instance.updateValue(10);
        expect(instance.value).toBe(10);
    });

    it('should throw an error when updating value to a negative number', () => {
        expect(() => instance.updateValue(-5)).toThrow('Value cannot be negative');
    });

    it('should return the correct string representation', () => {
        instance.updateValue(15);
        expect(instance.toString()).toBe('Value is 15'); // Assuming toString formats it this way
    });
});
