// Breadth-first dispatch, bounded per root event. A trigger cannot revisit itself
// along one path, but independent attacks still receive their own full budget.
export class TriggerQueue {
  constructor({maxDepth=8,maxEvents=128,maxPending=512}={}) {
    Object.assign(this,{maxDepth,maxEvents,maxPending});this.pending=[];this.history=[];
    this.context=null;this.draining=false;this.serial=0;this.suppressed=0;
  }
  enqueue(event) {
    const context=this.context||{root:{id:++this.serial,count:0},path:[]};
    if(context.root.count>=this.maxEvents||this.pending.length>=this.maxPending){this.suppressed++;return;}
    context.root.count++;this.pending.push({...event,context});
  }
  root(action) {
    if(this.context)return action();
    this.context={root:{id:++this.serial,count:0},path:[]};
    try{return action();}finally{this.context=null;}
  }
  branch(key,action) {
    const previous=this.context;
    if(!previous||previous.root.count>=this.maxEvents||previous.path.includes(key)||previous.path.length>=this.maxDepth){this.suppressed++;return false;}
    this.context={root:previous.root,path:[...previous.path,key]};
    try{action();}finally{this.context=previous;}return true;
  }
  drain(handler) {
    if(this.draining)return;
    this.draining=true;
    try {
      while(this.pending.length) {
        const event=this.pending.shift();this.context=event.context;
        const {context,...record}=event;
        this.history.push({...record,root:context.root.id,depth:context.path.length});
        if(this.history.length>256)this.history.shift();
        handler(event);
      }
    }finally{this.context=null;this.draining=false;}
  }
}
