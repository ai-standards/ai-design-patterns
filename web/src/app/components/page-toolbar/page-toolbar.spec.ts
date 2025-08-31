import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PageToolbar } from './page-toolbar';

describe('PageToolbar', () => {
  let component: PageToolbar;
  let fixture: ComponentFixture<PageToolbar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PageToolbar]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PageToolbar);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
