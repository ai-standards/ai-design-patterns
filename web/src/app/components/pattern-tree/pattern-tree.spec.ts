import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PatternTree } from './pattern-tree';

describe('PatternTree', () => {
  let component: PatternTree;
  let fixture: ComponentFixture<PatternTree>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PatternTree]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PatternTree);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
