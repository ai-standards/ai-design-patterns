import { TestBed } from '@angular/core/testing';

import { Pattern } from './pattern';

describe('Pattern', () => {
  let service: Pattern;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Pattern);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
