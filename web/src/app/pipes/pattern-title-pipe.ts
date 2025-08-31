import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'patternTitle'
})
export class PatternTitlePipe implements PipeTransform {

  transform(value: string): unknown {
    return value ? value.split('-').slice(1).join(' ') : ''
  }

}
