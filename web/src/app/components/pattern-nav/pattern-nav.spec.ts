import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PatternNav } from './pattern-nav';

describe('PatternNav', () => {
  let component: PatternNav;
  let fixture: ComponentFixture<PatternNav>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PatternNav]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PatternNav);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
